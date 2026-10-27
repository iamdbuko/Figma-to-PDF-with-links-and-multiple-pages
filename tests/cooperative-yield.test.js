const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');
const { createCooperativeYield } = require('../src/cooperative-yield.js');

function fakeChannel({ brokenPost = false } = {}) {
  const tasks = [];
  let closed = 0, posted = 0;
  class Channel {
    constructor() {
      this.port1 = { onmessage: null, close() { closed++; } };
      this.port2 = {
        close() { closed++; },
        postMessage: () => {
          if (brokenPost) throw new Error('Port unavailable');
          posted++;
          tasks.push(() => this.port1.onmessage?.());
        }
      };
    }
  }
  return { Channel, tasks, get closed() { return closed; }, get posted() { return posted; } };
}

test('FIFO yields resolve one per message task, never synchronously or in microtasks alone', async () => {
  const channel = fakeChannel(), completed = [];
  const yieldTask = createCooperativeYield({ MessageChannel: channel.Channel, setTimeout() { throw new Error('Timers must not be used'); } });
  const pending = [1, 2, 3].map(value => yieldTask().then(() => completed.push(value)));
  assert.equal(channel.tasks.length, 1, 'only one posted task is needed at a time');
  await Promise.resolve(); assert.deepEqual(completed, []);
  for (const value of [1, 2, 3]) {
    channel.tasks.shift()(); await Promise.resolve();
    assert.deepEqual(completed, [1, 2, 3].slice(0, value));
    assert.equal(channel.tasks.length, value === 3 ? 0 : 1);
  }
  await Promise.all(pending);
  assert.equal(channel.posted, 3);
  yieldTask.dispose(); assert.equal(channel.closed, 2);
});

test('queue compaction preserves every task and allows later reuse', async () => {
  const channel = fakeChannel(), completed = [];
  const yieldTask = createCooperativeYield({ MessageChannel: channel.Channel });
  const pending = Array.from({ length: 1500 }, (_, index) => yieldTask().then(() => completed.push(index)));
  while (channel.tasks.length) channel.tasks.shift()();
  await Promise.all(pending);
  assert.deepEqual(completed, Array.from({ length: 1500 }, (_, index) => index));
  const later = yieldTask(); channel.tasks.shift()(); await later;
  assert.equal(channel.posted, 1501);
  yieldTask.dispose();
});

test('a separately queued cancellation task can run between chained work yields', async () => {
  const channel = fakeChannel(), observed = [];
  const yieldTask = createCooperativeYield({ MessageChannel: channel.Channel });
  let cancelled = false;
  const work = (async () => {
    for (let index = 0; index < 5; index++) {
      await yieldTask();
      if (cancelled) break;
      observed.push(index);
    }
  })();
  const cancel = yieldTask().then(() => { cancelled = true; });
  while (channel.tasks.length) { channel.tasks.shift()(); await Promise.resolve(); }
  await Promise.all([work, cancel]);
  assert.deepEqual(observed, [0]);
  yieldTask.dispose();
});

test('missing or broken message channels fall back without changing global timers', async () => {
  const originalTimer = globalThis.setTimeout;
  const broken = fakeChannel({ brokenPost: true });
  for (const Channel of [null, class { constructor() { throw new Error('Unavailable'); } }, broken.Channel]) {
    const timers = [];
    const yieldTask = createCooperativeYield({ MessageChannel: Channel, setTimeout(callback, delay) { assert.equal(delay, 0); timers.push(callback); } });
    let completed = false;
    const pending = yieldTask().then(() => { completed = true; });
    await Promise.resolve(); assert.equal(completed, false);
    assert.equal(timers.length, 1); timers.shift()(); await pending;
    assert.equal(completed, true);
    yieldTask.dispose();
  }
  assert.equal(broken.closed, 2);
  assert.equal(globalThis.setTimeout, originalTimer);
});

test('disposal closes both ports, rejects pending work and makes posted stale tasks harmless', async () => {
  const channel = fakeChannel();
  const yieldTask = createCooperativeYield({ MessageChannel: channel.Channel });
  const pending = Promise.allSettled([yieldTask(), yieldTask()]);
  yieldTask.dispose(); yieldTask.dispose();
  while (channel.tasks.length) channel.tasks.shift()();
  const results = await pending;
  assert.ok(results.every(result => result.status === 'rejected' && /closed/.test(result.reason.message)));
  await assert.rejects(yieldTask(), /closed/);
  assert.equal(channel.closed, 2);
});

test('pending work is bounded and overflow does not disturb accepted tasks', async () => {
  const channel = fakeChannel();
  const yieldTask = createCooperativeYield({ MessageChannel: channel.Channel });
  const accepted = Array.from({ length: 4096 }, () => yieldTask());
  const pending = Promise.allSettled(accepted);
  await assert.rejects(yieldTask(), /Too many pending/);
  while (channel.tasks.length) channel.tasks.shift()();
  assert.ok((await pending).every(result => result.status === 'fulfilled'));
  yieldTask.dispose();
});

test('real MessageChannel tasks complete when zero-delay timers are unavailable', async () => {
  const yieldTask = createCooperativeYield({ MessageChannel, setTimeout() { throw new Error('Zero-delay timers unavailable'); } });
  try {
    let completed = false;
    const pending = yieldTask().then(() => { completed = true; });
    await Promise.resolve(); assert.equal(completed, false);
    await pending; assert.equal(completed, true);
    for (let index = 0; index < 100; index++) await yieldTask();
  } finally { yieldTask.dispose(); }
});

let library;
async function productionLibrary() {
  if (!library) library = import('../scripts/build.mjs').then(({ buildPdfLibrary }) => buildPdfLibrary());
  return library;
}

test('production pdf-lib retains its API and uses the shared scheduler for parsing and both saving paths', async () => {
  let yields = 0;
  const yieldTask = createCooperativeYield({ MessageChannel, setTimeout() { throw new Error('No timer fallback'); } });
  const sandbox = vm.createContext({
    console,
    setTimeout() { throw new Error('pdf-lib still used a zero-delay timer'); },
    __PDF_EXPORT_YIELD__: () => { yields++; return yieldTask(); }
  });
  try {
    const built = await productionLibrary();
    assert.match(built, /MIT License/);
    assert.match(built, /Copyright \(c\) 2019 Andrew Dillon/);
    for (const notice of ['2018 Andrew Dillon', '2017 Photopea', 'Vitaly Puzrin and Andrei Tuputcyn', 'Copyright (c) Microsoft Corporation.']) {
      assert.ok(built.includes(notice), `dependency notice retained: ${notice}`);
    }
    vm.runInContext(built, sandbox);
    assert.deepEqual(Object.keys(sandbox.PDFLib).sort(), Object.keys(require('pdf-lib')).sort(), 'the complete pinned API remains available');
    for (const name of ['PDFParser', 'PDFObjectParser', 'PDFRawStream', 'PDFDocument']) assert.equal(typeof sandbox.PDFLib[name], 'function');
    for (const useObjectStreams of [false, true]) {
      sandbox.useObjectStreams = useObjectStreams;
      const beforeSave = yields;
      await vm.runInContext(`(async () => {
        const document = await PDFLib.PDFDocument.create();
        for (let index = 0; index < 20; index++) document.addPage([100, 100]).drawRectangle({x: 1, y: 1, width: 10, height: 10});
        globalThis.savedPdf = await document.save({ objectsPerTick: 1, useObjectStreams });
      })()`, sandbox);
      assert.ok(yields > beforeSave, `save with object streams=${useObjectStreams} must yield through the shared scheduler`);
      const beforeParse = yields;
      const count = await vm.runInContext('(async () => (await PDFLib.PDFDocument.load(savedPdf, {parseSpeed: 1})).getPageCount())()', sandbox);
      assert.equal(count, 20);
      assert.ok(yields > beforeParse, 'document and object-stream parsing use the shared scheduler');
    }
  } finally { yieldTask.dispose(); }
});

test('production library keeps its timer fallback when no shared scheduler is installed', async () => {
  let timers = 0;
  const sandbox = vm.createContext({ console, setTimeout(callback, delay) { assert.equal(delay, 0); timers++; setImmediate(callback); } });
  vm.runInContext(await productionLibrary(), sandbox);
  await sandbox.PDFLib.waitForTick();
  assert.equal(timers, 1);
});
