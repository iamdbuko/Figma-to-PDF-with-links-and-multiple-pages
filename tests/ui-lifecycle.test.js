const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const PDFLib = require('pdf-lib');

const root = path.resolve(__dirname, '..');
const png = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64')];
const p3Png = [...fs.readFileSync(path.join(__dirname, 'fixtures/color-profiles/native-DISPLAY_P3_V4.png'))];
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
  const profilesByJob = new Map();
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
    window.createdUrls = []; window.revokedUrls = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.createdUrls.push(url); return url; };
    URL.revokeObjectURL = url => { window.revokedUrls.push(url); return revoke(url); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.downloadClicks++; return click.call(this); };
  });
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  const messages = type => page.evaluate(type => received.filter(message => message.type === type), type);
  const waitMessage = async (type, fields = {}) => {
    await page.waitForFunction(({ type, fields }) => received.some(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)), { type, fields }, { timeout: 5000 });
    return page.evaluate(({ type, fields }) => received.findLast(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)), { type, fields });
  };
  const start = async (frames = [first], options = {}) => {
    const previousRequests = (await messages('export-pdf')).length;
    await post({ type: 'frames-updated', frames, connections: options.links || [], justAdded: frames.map(item => item.id) });
    if (options.pagesPerPart) {
      await frame.locator('#output-mode').selectOption('parts');
      await frame.locator('#pages-per-part').fill(String(options.pagesPerPart));
    }
    if (options.rasterFormat) await frame.locator('#raster-format').selectOption(options.rasterFormat);
    if (options.fitOversized) await frame.locator('#fit-oversized').check();
    if (options.colorProfile) await frame.locator('#color-profile').selectOption(options.colorProfile);
    await frame.locator('#export-btn').click();
    await page.waitForFunction(count => received.filter(message => message.type === 'export-pdf').length > count, previousRequests);
    const request = await waitMessage('export-pdf');
    const ordered = request.selectedFrames.map(id => frames.find(item => item.id === id));
    const exportColorProfile = options.resolvedProfile || (request.colorProfile === 'DOCUMENT' ? 'SRGB' : request.colorProfile);
    profilesByJob.set(request.jobId, exportColorProfile);
    await post({ type: 'export-start', jobId: request.jobId, frames: ordered, connections: options.links || [], exportColorProfile });
    await frame.waitForFunction(() => activeJob?.started);
    return request;
  };
  const pageMessage = (jobId, index = 0, item = first, format = 'PNG', data) => {
    const exportColorProfile = profilesByJob.get(jobId) || 'SRGB';
    return { type: 'export-page', jobId, index, frame: item, format, data: data ?? (exportColorProfile === 'DISPLAY_P3_V4' ? p3Png : png), exportColorProfile };
  };
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
  await h.post({ type: 'export-start', jobId: request.jobId, frames: [frames[0], malicious], connections: [], exportColorProfile: 'SRGB' });
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

test('JPEG fallback preserves compressed pixels and annotations and sends opt-in sizing settings', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const request = await h.start([first], { rasterFormat: 'JPG', fitOversized: true });
  assert.equal(request.rasterFormat, 'JPG');
  assert.equal(request.fitOversized, true);
  const jpeg = await h.frame.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 6;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3498a3'; ctx.fillRect(0, 0, 8, 6);
    return Array.from(atob(canvas.toDataURL('image/jpeg', .9).split(',')[1]), character => character.charCodeAt(0));
  });
  await h.post(h.pageMessage(request.jobId, 0, first, 'PDF', [1, 2, 3]));
  await h.waitMessage('page-ack', { jobId: request.jobId, fallback: true });
  await h.post({ ...h.pageMessage(request.jobId, 0, first, 'JPG', jpeg), annotationPdfData: nativePdf });
  await h.waitMessage('page-ack', { jobId: request.jobId, index: 0, fallback: undefined });
  const downloadPromise = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId: request.jobId });
  await h.waitMessage('export-finished', { jobId: request.jobId });
  const document = await PDFLib.PDFDocument.load(fs.readFileSync(await (await downloadPromise).path()));
  const outputPage = document.getPage(0);
  assert.deepEqual(outputPage.getSize(), { width: 600, height: 400 });
  const images = outputPage.node.Resources().lookup(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict).values().map(ref => document.context.lookup(ref));
  assert.equal(images.length, 1);
  assert.equal(images[0].dict.get(PDFLib.PDFName.of('Filter')).toString(), '/DCTDecode');
  assert.deepEqual([...images[0].getContents()], jpeg, 'JPEG bytes are retained directly rather than expanded and recompressed');
  assert.equal(outputPage.node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).size(), 5);
  assert.deepEqual(h.errors, []);
});

test('multipart export pauses without ACK, releases each PDF, and preserves cross-file destinations', { timeout: 20000 }, async t => {
  const h = await harness(t);
  const frames = ['a', 'b', 'c'].map(id => ({ ...first, id, name: 'Same name' }));
  const links = [
    { fromFrameId: 'a', toFrameId: 'c', source: 'prototype', type: 'internal', elementBounds: { x: 10, y: 20, width: 30, height: 40 } },
    { fromFrameId: 'c', toFrameId: 'b', source: 'prototype', type: 'internal', elementBounds: { x: 50, y: 60, width: 70, height: 80 } }
  ];
  const { jobId } = await h.start(frames, { pagesPerPart: 2, links, colorProfile: 'DOCUMENT', resolvedProfile: 'DISPLAY_P3_V4' });
  assert.equal(await h.frame.evaluate(() => activeJob.exportColorProfile), 'DISPLAY_P3_V4');
  await h.frame.evaluate(() => {
    const append = appendExportPage;
    window.appendedProfiles = [];
    appendExportPage = (...args) => { window.appendedProfiles.push(args[1].exportColorProfile); return append(...args); };
  });
  const filenames = await h.frame.evaluate(() => activeJob.parts.map(part => part.filename));
  await h.post(h.pageMessage(jobId, 0, frames[0]));
  await h.waitMessage('page-ack', { jobId, index: 0 });
  const firstDownloadPromise = h.page.waitForEvent('download');
  await h.post(h.pageMessage(jobId, 1, frames[1]));
  await h.waitMessage('part-ready', { jobId, index: 1 });
  const firstDownload = await firstDownloadPromise;
  await h.frame.waitForFunction(() => activeJob?.awaitingContinue);
  assert.equal((await h.messages('page-ack')).filter(message => message.index === 1).length, 0);
  assert.deepEqual(await h.frame.evaluate(() => ({ pdf: activeJob.pdf, pages: activeJob.pages.length, retained: activeJob.retainedBytes })), { pdf: null, pages: 0, retained: 0 });
  assert.equal(await h.frame.locator('#continue-btn').isEnabled(), true);
  for (const selector of ['#export-btn', '#raster-format', '#output-mode', '#pages-per-part', '#fit-oversized', '#color-profile']) assert.equal(await h.frame.locator(selector).isDisabled(), true, selector);
  assert.equal(await h.frame.evaluate(() => activeJob.exportColorProfile), 'DISPLAY_P3_V4');
  // A later control value cannot change the profile already resolved for this job.
  await h.frame.evaluate(() => { document.getElementById('color-profile').value = 'SRGB'; });
  await h.post(h.pageMessage(jobId, 1, frames[1]));
  await h.frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 1);
  const previousUrl = await h.frame.evaluate(() => activeJob.blobUrl);
  await h.frame.evaluate(() => { continueExport(); continueExport(); });
  await h.waitMessage('page-ack', { jobId, index: 1 });
  assert.equal((await h.messages('page-ack')).filter(message => message.index === 1).length, 1);
  assert.equal(await h.frame.evaluate(url => window.revokedUrls.includes(url), previousUrl), true);
  assert.equal(await h.frame.evaluate(() => activeJob.pdf.getPageCount()), 0);
  assert.equal(await h.frame.evaluate(() => activeJob.exportColorProfile), 'DISPLAY_P3_V4');
  await h.post(h.pageMessage(jobId, 2, frames[2]));
  await h.waitMessage('page-ack', { jobId, index: 2 });
  const secondDownloadPromise = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  const secondDownload = await secondDownloadPromise;
  assert.deepEqual([firstDownload.suggestedFilename(), secondDownload.suggestedFilename()], filenames);
  const documents = await Promise.all([firstDownload, secondDownload].map(async download => PDFLib.PDFDocument.load(fs.readFileSync(await download.path()))));
  assert.deepEqual(documents.map(document => document.getPageCount()), [2, 1]);
  for (const [partIndex, targetPart, targetPage] of [[0, 1, 0], [1, 0, 1]]) {
    const annotation = documents[partIndex].getPage(0).node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).lookup(0, PDFLib.PDFDict);
    const action = annotation.lookup(PDFLib.PDFName.of('A'), PDFLib.PDFDict);
    assert.equal(action.get(PDFLib.PDFName.of('S')).toString(), '/GoToR');
    assert.equal(action.lookup(PDFLib.PDFName.of('F')).decodeText(), filenames[targetPart]);
    assert.equal(action.lookup(PDFLib.PDFName.of('D'), PDFLib.PDFArray).lookup(0).asNumber(), targetPage);
  }
  assert.equal(await h.frame.evaluate(() => activeJob), null);
  assert.deepEqual(await h.frame.evaluate(() => window.appendedProfiles), ['DISPLAY_P3_V4', 'DISPLAY_P3_V4', 'DISPLAY_P3_V4']);
  assert.equal(await h.frame.locator('#color-profile').isEnabled(), true);
  assert.deepEqual(h.errors, []);
});

for (const ending of ['cancel', 'timeout']) test(`${ending} while paused reports prior parts and releases the pending Blob`, { timeout: 15000 }, async t => {
  const h = await harness(t);
  const frames = [first, { ...first, id: 'second' }];
  const { jobId } = await h.start(frames, { pagesPerPart: 1 });
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('part-ready', { jobId, index: 0 });
  await h.frame.waitForFunction(() => activeJob?.awaitingContinue);
  const url = await h.frame.evaluate(() => activeJob.blobUrl);
  if (ending === 'cancel') {
    await h.frame.locator('#cancel-btn').click();
    await h.waitMessage('export-cancel', { jobId });
    await h.post({ type: 'export-cancelled', jobId });
  } else await h.post({ type: 'export-error', jobId, error: 'The continuation deadline expired.' });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.match(await h.frame.locator('#status-title').textContent(), /Download started for 1 part/);
  assert.match(await h.frame.locator('#status-title').textContent(), /Links to unfinished parts will not work/);
  assert.equal(await h.frame.evaluate(url => window.revokedUrls.includes(url), url), true);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 1);
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  assert.equal((await h.messages('page-ack')).length, 0);
  assert.deepEqual(h.errors, []);
});

test('retained-budget failure on an imported native page never requests raster fallback', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start();
  await h.frame.evaluate(() => { const check = assertPdfBudget; assertPdfBudget = document => check(document, 1000); });
  await h.post(h.pageMessage(jobId, 0, first, 'PDF', nativePdf));
  const failure = await h.waitMessage('export-failed', { jobId });
  assert.match(failure.message, /retained-data allowance/);
  assert.equal((await h.messages('page-ack')).length, 0);
  assert.equal(await h.frame.evaluate(() => activeJob.nextIndex), 0);
  await h.post({ type: 'export-error', jobId, error: failure.message });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.deepEqual(h.errors, []);
});

test('annotations are included in the final pre-save retained-budget check', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const links = Array.from({ length: 20 }, (_, i) => ({ source: 'prototype', type: 'external', fromFrameId: first.id, toUrl: `https://example.com/${i}`, elementBounds: { x: i * 10, y: 20, width: 10, height: 10 } }));
  const { jobId } = await h.start([first], { links });
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('page-ack', { jobId, index: 0 });
  await h.frame.evaluate(() => { const limit = estimatePdfBytes(activeJob.pdf) + 100, check = assertPdfBudget; assertPdfBudget = document => check(document, limit); });
  await h.post({ type: 'export-complete', jobId });
  const failure = await h.waitMessage('export-failed', { jobId });
  assert.match(failure.message, /retained-data allowance/);
  await h.post({ type: 'export-error', jobId, error: failure.message });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.deepEqual(h.errors, []);
});

test('color choices are sent explicitly and the concrete resolved profile is frozen per job', { timeout: 20000 }, async t => {
  for (const [choice, resolved] of [['SRGB', 'SRGB'], ['DISPLAY_P3_V4', 'DISPLAY_P3_V4'], ['DOCUMENT', 'DISPLAY_P3_V4'], ['DOCUMENT', 'SRGB']]) {
    const h = await harness(t);
    assert.equal(await h.frame.locator('#color-profile').inputValue(), 'SRGB', 'sRGB is the compatibility default');
    const request = await h.start([first], { colorProfile: choice, resolvedProfile: resolved });
    assert.equal(request.colorProfile, choice);
    assert.equal(await h.frame.evaluate(() => activeJob.exportColorProfile), resolved);
    assert.deepEqual(await h.frame.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(activeJob, 'exportColorProfile');
      return { writable: descriptor.writable, configurable: descriptor.configurable };
    }), { writable: false, configurable: false });
    assert.equal(await h.frame.locator('#color-profile').isDisabled(), true);
    await h.frame.locator('#cancel-btn').click();
    await h.waitMessage('export-cancel', { jobId: request.jobId });
    await h.post({ type: 'export-cancelled', jobId: request.jobId });
    await h.frame.waitForFunction(() => activeJob === null);
    assert.equal(await h.frame.locator('#color-profile').isEnabled(), true);
    assert.deepEqual(h.errors, []);
  }
});

test('inconsistent or missing page color profiles fail before import without raster retry', { timeout: 15000 }, async t => {
  for (const receivedProfile of ['SRGB', undefined]) {
    const h = await harness(t);
    const { jobId } = await h.start([first], { colorProfile: 'DOCUMENT', resolvedProfile: 'DISPLAY_P3_V4' });
    await h.frame.evaluate(() => {
      const append = appendExportPage;
      window.appendCalls = 0;
      appendExportPage = (...args) => { window.appendCalls++; return append(...args); };
    });
    await h.post({ ...h.pageMessage(jobId, 0, first, 'PDF', nativePdf), exportColorProfile: receivedProfile });
    const failure = await h.waitMessage('export-failed', { jobId });
    assert.match(failure.message, /page color profile differs/);
    assert.equal(await h.frame.evaluate(() => window.appendCalls), 0);
    assert.equal(await h.frame.evaluate(() => activeJob.nextIndex), 0);
    assert.equal((await h.messages('page-ack')).length, 0);
    await h.post({ type: 'export-error', jobId, error: failure.message });
    await h.frame.waitForFunction(() => activeJob === null);
    assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
    assert.deepEqual(h.errors, []);
  }
});

test('export initialization rejects unresolved or contradictory color profiles', { timeout: 15000 }, async t => {
  for (const [choice, resolved] of [['SRGB', 'DISPLAY_P3_V4'], ['DOCUMENT', 'DOCUMENT'], ['DOCUMENT', undefined]]) {
    const h = await harness(t);
    await h.post({ type: 'frames-updated', frames: [first], connections: [], justAdded: [first.id] });
    await h.frame.locator('#color-profile').selectOption(choice);
    await h.frame.locator('#export-btn').click();
    const { jobId } = await h.waitMessage('export-pdf');
    await h.post({ type: 'export-start', jobId, frames: [first], connections: [], exportColorProfile: resolved });
    const failure = await h.waitMessage('export-failed', { jobId });
    assert.match(failure.message, /color profile/);
    assert.equal(await h.frame.evaluate(() => activeJob.started), false);
    assert.equal(await h.frame.evaluate(() => activeJob.pdf), null);
    await h.post({ type: 'export-error', jobId, error: failure.message });
    await h.frame.waitForFunction(() => activeJob === null);
    assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
    assert.deepEqual(h.errors, []);
  }
});
