const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const png = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64')];
const nativePdf = [...fs.readFileSync(path.join(__dirname, 'fixtures/native-links.pdf'))];
const first = { id: 'first', name: 'Page 1', width: 600, height: 400, parent: 'Page' };
let browser;

test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function harness(t) {
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const downloads = [], errors = [];
  page.on('download', download => downloads.push(download));
  page.on('pageerror', error => errors.push(error.message));
  // Only an isolated local document is controlled; no Figma account or user browser is used.
  await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe title="Plugin UI" style="width:400px;height:700px"></iframe>');
  const frame = page.frames().find(item => item !== page.mainFrame());
  await frame.setContent(fs.readFileSync(path.join(root, 'ui.html'), 'utf8'));
  assert.deepEqual(errors, [], 'the built HTML and bundled library must parse in a real browser');
  assert.equal(await frame.evaluate(() => typeof PDFLib), 'object', 'the bundled PDF library is available');
  await frame.waitForFunction(() => typeof startExport === 'function', {}, { timeout: 5000 });
  await frame.evaluate(() => {
    window.downloadClicks = 0;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.downloadClicks++; return click.call(this); };
  });
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  const messages = type => page.evaluate(type => received.filter(message => message.type === type), type);
  const waitMessage = async (type, fields = {}) => {
    await page.waitForFunction(({ type, fields }) => received.some(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)), { type, fields }, { timeout: 5000 });
    return page.evaluate(({ type, fields }) => received.findLast(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)), { type, fields });
  };
  const start = async (frames = [first]) => {
    const previousRequests = (await messages('export-pdf')).length;
    await post({ type: 'frames-updated', frames, connections: [], justAdded: frames.map(item => item.id) });
    await frame.locator('#export-btn').click();
    await page.waitForFunction(count => received.filter(message => message.type === 'export-pdf').length > count, previousRequests);
    const request = await waitMessage('export-pdf');
    const ordered = request.selectedFrames.map(id => frames.find(item => item.id === id));
    await post({ type: 'export-start', jobId: request.jobId, frames: ordered, connections: [] });
    await frame.waitForFunction(() => activeJob?.started);
    return request;
  };
  const pageMessage = (jobId, index = 0, item = first, format = 'PNG', data = png) => ({ type: 'export-page', jobId, index, frame: item, format, data });
  return { page, frame, post, messages, waitMessage, start, pageMessage, downloads, errors };
}

test('cancelling during save waits for pending work and prevents any download', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start();
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('page-ack', { jobId, index: 0 });
  await h.frame.evaluate(() => {
    const save = activeJob.pdf.save.bind(activeJob.pdf);
    activeJob.pdf.save = options => new Promise((resolve, reject) => { window.finishSave = () => save(options).then(resolve, reject); });
  });
  await h.post({ type: 'export-complete', jobId });
  await h.frame.waitForFunction(() => typeof window.finishSave === 'function');
  await h.frame.locator('#cancel-btn').click();
  await h.waitMessage('export-cancel', { jobId });
  await h.post({ type: 'export-cancelled', jobId });
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true, 'saving remains locked until its promise settles');
  await h.frame.evaluate(() => window.finishSave());
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), false);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.equal(h.downloads.length, 0);
  assert.equal((await h.messages('export-finished')).length, 0);
  assert.deepEqual(h.errors, []);
});

test('stale messages from a cancelled export cannot affect a restarted job', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const old = await h.start();
  await h.frame.locator('#cancel-btn').click();
  await h.waitMessage('export-cancel', { jobId: old.jobId });
  await h.post({ type: 'export-cancelled', jobId: old.jobId });
  await h.frame.waitForFunction(() => activeJob === null);
  const current = await h.start();
  assert.notEqual(current.jobId, old.jobId);
  await h.post(h.pageMessage(old.jobId));
  await h.post({ type: 'export-complete', jobId: old.jobId });
  await h.post({ type: 'export-error', jobId: old.jobId, message: 'Old error' });
  await h.frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await h.frame.evaluate(() => activeJob.id), current.jobId);
  assert.equal(await h.frame.evaluate(() => activeJob.nextIndex), 0);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  await h.post(h.pageMessage(current.jobId));
  await h.waitMessage('page-ack', { jobId: current.jobId });
  await h.post({ type: 'export-complete', jobId: current.jobId });
  await h.waitMessage('export-finished', { jobId: current.jobId });
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 1);
  assert.deepEqual(h.errors, []);
});

test('duplicate in-flight page messages are consumed and acknowledged once', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start();
  await h.frame.evaluate(() => {
    const append = appendExportPage;
    window.appendCalls = 0;
    appendExportPage = async (...args) => {
      window.appendCalls++;
      await new Promise(resolve => { window.finishAppend = resolve; });
      return append(...args);
    };
  });
  await h.post(h.pageMessage(jobId));
  await h.frame.waitForFunction(() => typeof window.finishAppend === 'function');
  await h.post(h.pageMessage(jobId));
  await h.frame.evaluate(() => window.finishAppend());
  await h.waitMessage('page-ack', { jobId });
  assert.equal(await h.frame.evaluate(() => window.appendCalls), 1);
  assert.equal(await h.frame.evaluate(() => activeJob.pdf.getPageCount()), 1);
  assert.equal((await h.messages('page-ack')).length, 1);
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 1);
  assert.deepEqual(h.errors, []);
});

test('corrupt PDF asks for one PNG retry and completes with exactly one page', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start();
  await h.post(h.pageMessage(jobId, 0, first, 'PDF', [1, 2, 3]));
  await h.waitMessage('page-ack', { jobId, fallback: true });
  await h.post(h.pageMessage(jobId, 0, first, 'PDF', [1, 2, 3]));
  await h.frame.waitForFunction(() => activeJob.pendingPage === null);
  await h.post({ ...h.pageMessage(jobId), annotationPdfData: nativePdf });
  await h.waitMessage('page-ack', { jobId, index: 0, fallback: undefined });
  assert.equal((await h.messages('page-ack')).filter(message => message.fallback).length, 1);
  assert.equal(await h.frame.evaluate(() => activeJob.pdf.getPageCount()), 1);
  assert.equal(await h.frame.evaluate(() => nativeLinkRecords(activeJob.pdf, activeJob.pages[0]).length), 5);
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 1);
  assert.deepEqual(h.errors, []);
});

test('failed PNG reports failure, recovers controls, and never downloads a blank PDF', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start();
  await h.post(h.pageMessage(jobId, 0, first, 'PNG', [1, 2, 3]));
  const failure = await h.waitMessage('export-failed', { jobId });
  assert.match(failure.message, /Could not create page/);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.post({ type: 'export-error', jobId, message: failure.message });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), false);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.equal((await h.messages('export-finished')).length, 0);
  assert.match(await h.frame.locator('#status-title').textContent(), /Export failed/);
  assert.deepEqual(h.errors, []);
});

test('selection updates preserve sorting and checks, render names safely, and never unlock an active export', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const frames = [{ ...first, id: 'ten', name: 'Page 10' }, { ...first, id: 'two', name: 'Page 2' }];
  await h.post({ type: 'frames-updated', frames, connections: [], justAdded: frames.map(item => item.id) });
  await h.frame.locator('#sort-select').selectOption('az');
  await h.frame.locator('[data-frame-id="two"] .frame-checkbox').uncheck();
  const malicious = { ...first, id: 'literal', name: '<img src=x onerror="window.injected=true">', parent: '<svg onload=alert(1)>' };
  await h.post({ type: 'frames-updated', frames: [...frames, malicious], connections: [], justAdded: ['literal'] });
  await h.frame.waitForFunction(() => allFrames.length === 3);
  assert.deepEqual(await h.frame.locator('.frame-item').evaluateAll(items => items.map(item => item.dataset.frameId)), ['two', 'ten', 'literal']);
  assert.equal(await h.frame.locator('[data-frame-id="two"] .frame-checkbox').isChecked(), false);
  assert.equal(await h.frame.locator('img, svg').count(), 0);
  assert.equal(await h.frame.locator('[data-frame-id="literal"] .frame-name').textContent(), malicious.name);
  await h.frame.locator('#export-btn').click();
  const request = await h.waitMessage('export-pdf');
  assert.deepEqual(request.selectedFrames, ['ten', 'literal']);
  await h.post({ type: 'export-start', jobId: request.jobId, frames: [frames[0], malicious], connections: [] });
  await h.frame.waitForFunction(() => activeJob?.started);
  await h.post({ type: 'frames-updated', frames: [...frames, malicious, { ...first, id: 'new' }], connections: [], justAdded: ['new'] });
  await h.post({ type: 'selection-changed', selectedFrameIds: ['ten'], selectedFrameNames: ['Page 10'] });
  await h.frame.waitForFunction(() => deferredFrames !== null);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  assert.equal(await h.frame.locator('#sort-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#quality-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#cancel-btn').isEnabled(), true);
  assert.equal(await h.frame.locator('.frame-checkbox:enabled').count(), 0);
  await h.post({ type: 'export-error', jobId: request.jobId, message: 'Test ended' });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.deepEqual(await h.frame.locator('.frame-item').evaluateAll(items => items.map(item => item.dataset.frameId)), ['two', 'ten', 'literal', 'new']);
  assert.equal(await h.frame.locator('[data-frame-id="two"] .frame-checkbox').isChecked(), false);
  assert.deepEqual(h.errors, []);
});

test('Figma synthetic messages with a null event source update the frame list', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.frame.evaluate(frame => {
    window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { type: 'frames-updated', frames: [frame], connections: [], justAdded: [frame.id] } } }));
  }, first);
  await h.frame.waitForFunction(() => allFrames.length === 1);
  assert.equal(await h.frame.locator('.frame-name').textContent(), first.name);
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  assert.deepEqual(h.errors, []);
});

test('Figma relayed messages whose source differs from parent update the frame list', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.frame.evaluate(frame => {
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { pluginMessage: { type: 'frames-updated', frames: [frame], connections: [], justAdded: [frame.id] } } }));
  }, first);
  await h.frame.waitForFunction(() => allFrames.length === 1);
  assert.equal(await h.frame.locator('.frame-name').textContent(), first.name);
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  assert.deepEqual(h.errors, []);
});
