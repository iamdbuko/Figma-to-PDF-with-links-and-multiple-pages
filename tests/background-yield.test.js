const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const P = require('pdf-lib');

// Deterministic timer-fault injection, not an imitation of Figma's visibility or
// OS suspension. Only zero-delay timers are withheld; posted messages and real
// delayed watchdog/cleanup timers remain available.
const root = path.resolve(__dirname, '..');
const frameInfo = { id: 'timer-probe', name: 'Timer probe', width: 120, height: 120, parent: 'Synthetic' };
let browser, fixture;
test.before(async () => {
  const doc = await P.PDFDocument.create(), page = doc.addPage([120, 120]), ctx = doc.context;
  const rgb = new Uint8Array(600 * 600 * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 19 + Math.floor(i / 1800)) % 256;
  const photo = ctx.register(ctx.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 600, Height: 600, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' }));
  page.node.set(P.PDFName.of('Resources'), ctx.obj({ XObject: { Photo: photo } }));
  page.node.set(P.PDFName.of('Contents'), ctx.register(ctx.flateStream('0.2 0.4 0.6 rg\n'.repeat(9000) + 'q\n120 0 0 120 0 0 cm\n/Photo Do\nQ\n')));
  fixture = [...await doc.save({ objectsPerTick: Infinity, useObjectStreams: false })];
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });

async function harness(t, mode, dpi = '72') {
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage(), downloads = [], errors = [];
  page.on('download', download => downloads.push(download));
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<script>window.messages=[];addEventListener("message",e=>{if(e.data?.pluginMessage)messages.push(e.data.pluginMessage)})</script><iframe style="width:400px;height:750px"></iframe>');
  const frame = page.frames().find(frame => frame !== page.mainFrame());
  await frame.setContent(fs.readFileSync(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8'));
  assert.equal(await frame.evaluate(() => typeof globalThis.__PDF_EXPORT_YIELD__), 'function');
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  const messages = type => page.evaluate(type => window.messages.filter(message => message.type === type), type);
  const wait = async type => {
    await page.waitForFunction(type => window.messages.some(message => message.type === type), type, { timeout: 10000 });
    return (await messages(type)).at(-1);
  };
  await post({ type: 'frames-updated', frames: [frameInfo], connections: [], justAdded: [frameInfo.id] });
  await frame.locator('label[for="export-vector"]').click();
  await frame.locator('#vector-image-dpi').selectOption(dpi);
  await frame.locator('#color-profile').selectOption(mode === 'CMYK' ? 'CMYK' : 'DOCUMENT');
  await frame.locator('#export-btn').click();
  const { jobId } = await wait('export-pdf');
  await post({ type: 'export-start', jobId, frames: [frameInfo], connections: [], exportColorProfile: 'SRGB', outputColorMode: mode });
  await frame.waitForFunction(() => activeJob?.started);
  await frame.evaluate(() => {
    window.blockedZeroTimers = 0; window.delayedTimers = []; window.sessionCloses = 0;
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === undefined || Number(delay) === 0) { window.blockedZeroTimers++; return -window.blockedZeroTimers; }
      window.delayedTimers.push(Number(delay)); return nativeTimeout(callback, delay, ...args);
    };
    window.delayedTimerProbe = new Promise(resolve => setTimeout(resolve, 5));
    if (activeJob.cmykSession) {
      const close = activeJob.cmykSession.close.bind(activeJob.cmykSession);
      activeJob.cmykSession.close = () => { window.sessionCloses++; close(); };
    }
    const save = activeJob.pdf.save.bind(activeJob.pdf);
    activeJob.pdf.save = options => save({ ...options, objectsPerTick: 1 });
  });
  return { page, frame, post, wait, messages, jobId, downloads, errors,
    sendPage: () => post({ type: 'export-page', jobId, index: 0, frame: frameInfo, format: 'PDF', data: fixture, exportColorProfile: 'SRGB', outputColorMode: mode }) };
}

for (const mode of ['RGB', 'CMYK']) test(`${mode} parse, image resize, conversion and download finish with zero-delay timers withheld`, { timeout: 30000 }, async t => {
  const h = await harness(t, mode);
  // Force the pinned parser's own cooperative path, regardless of object count.
  assert.equal(await h.frame.evaluate(async bytes => (await pdfLoader.load(new Uint8Array(bytes), { parseSpeed: 1 })).getPageCount(), fixture), 1);
  await h.sendPage(); await h.wait('page-ack');
  await h.post({ type: 'export-complete', jobId: h.jobId }); await h.wait('export-finished');
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(h.downloads.length, 1);
  const doc = await P.PDFDocument.load(fs.readFileSync(await h.downloads[0].path()));
  assert.equal(doc.getPageCount(), 1); assert.deepEqual(doc.getPage(0).getSize(), { width: 120, height: 120 });
  const photo = doc.getPage(0).node.Resources().lookup(P.PDFName.of('XObject')).lookup(P.PDFName.of('Photo'));
  assert.equal(photo.dict.lookup(P.PDFName.of('Width')).asNumber(), 120, 'the real resampler reduced the 600px image to 72 DPI');
  assert.equal(photo.dict.lookup(P.PDFName.of('Height')).asNumber(), 120);
  if (mode === 'CMYK') {
    const space = photo.dict.lookup(P.PDFName.of('ColorSpace'));
    assert.equal(space.get(0).toString(), '/ICCBased');
    assert.equal(doc.context.lookup(space.get(1)).dict.lookup(P.PDFName.of('N')).asNumber(), 4);
  }
  const state = await h.frame.evaluate(async () => {
    await delayedTimerProbe;
    return { blocked: blockedZeroTimers, delayed: delayedTimers, closes: sessionCloses, enabled: !$('export-btn').disabled };
  });
  assert.equal(state.blocked, 0, 'all production cooperative paths use posted-message yields');
  assert(state.delayed.includes(5)); assert(state.delayed.includes(60000), 'Blob cleanup retains its real delayed timer');
  assert.equal(state.closes, mode === 'CMYK' ? 1 : 0); assert.equal(state.enabled, true);
  assert.deepEqual(h.errors, []);
});

test('queued cancellation interrupts real vector CMYK and releases the session while zero-delay timers are withheld', { timeout: 30000 }, async t => {
  const h = await harness(t, 'CMYK', 'original');
  await h.frame.evaluate(() => {
    const factory = createVectorCmykConverter, cancelChannel = new MessageChannel();
    window.vectorYieldCount = 0;
    cancelChannel.port1.onmessage = () => {
      cancelChannel.port1.close(); cancelChannel.port2.close();
      cancelExport();
    };
    createVectorCmykConverter = (library, options) => factory(library, { ...options, yieldToBrowser: async () => {
      if (++window.vectorYieldCount === 2) cancelChannel.port2.postMessage(null);
      await options.yieldToBrowser();
    } });
  });
  await h.sendPage(); await h.wait('export-cancel');
  await h.post({ type: 'export-cancelled', jobId: h.jobId });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(h.downloads.length, 0); assert.equal((await h.messages('page-ack')).length, 0);
  assert.deepEqual(await h.frame.evaluate(() => ({ yields: vectorYieldCount, blocked: blockedZeroTimers, closes: sessionCloses, enabled: !$('export-btn').disabled })),
    { yields: 2, blocked: 0, closes: 1, enabled: true });
  assert.deepEqual(h.errors, []);
});
