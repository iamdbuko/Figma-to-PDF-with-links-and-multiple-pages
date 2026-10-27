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
  const modesByJob = new Map();
  page.on('download', download => downloads.push(download));
  page.on('pageerror', error => errors.push(error.message));
  // Only an isolated local document is controlled; no Figma account or user browser is used.
  await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe title="Plugin UI" style="width:400px;height:700px"></iframe>');
  const frame = page.frames().find(item => item !== page.mainFrame());
  await frame.setContent(fs.readFileSync(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8'));
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
  const openSettings = async () => {
    if (await frame.locator('#frames-screen').isVisible()) await frame.locator('#open-settings-btn').click();
    await frame.locator('#settings-screen').waitFor({ state: 'visible' });
  };
  const start = async (frames = [first], options = {}) => {
    const previousRequests = (await messages('export-pdf')).length;
    await post({ type: 'frames-updated', frames, connections: options.links || [], justAdded: frames.map(item => item.id) });
    await openSettings();
    if (options.pagesPerPart) {
      await frame.locator('#output-mode').selectOption('parts', { force: true });
      await frame.locator('#pages-per-part').fill(String(options.pagesPerPart));
    }
    if (options.rasterFormat) await frame.locator('#raster-format').selectOption(options.rasterFormat, { force: true });
    if (options.fitOversized) await frame.locator('#fit-oversized').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    if (options.exportType) await frame.locator(`label[for="export-${options.exportType}"]`).click();
    if (options.colorProfile) await frame.locator('#color-profile').selectOption(options.colorProfile, { force: true });
    if (options.iccBuffer) {
      await frame.locator('#cmyk-profile-source').selectOption('CUSTOM', { force: true });
      await frame.locator('#cmyk-profile').setInputFiles({ name: 'printer.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from(options.iccBuffer) });
      await frame.waitForFunction(() => !readingCmykProfile && selectedCmykProfile);
    }
    await frame.locator('#export-btn').click();
    await page.waitForFunction(count => received.filter(message => message.type === 'export-pdf').length > count, previousRequests);
    const request = await waitMessage('export-pdf');
    const ordered = request.selectedFrames.map(id => frames.find(item => item.id === id));
    const exportColorProfile = options.resolvedProfile || (['DOCUMENT', 'CMYK'].includes(request.colorProfile) ? 'SRGB' : request.colorProfile);
    const outputColorMode = request.colorProfile === 'CMYK' ? 'CMYK' : 'RGB';
    profilesByJob.set(request.jobId, exportColorProfile);
    modesByJob.set(request.jobId, outputColorMode);
    await post({ type: 'export-start', jobId: request.jobId, frames: ordered, connections: options.links || [], exportColorProfile, outputColorMode });
    await frame.waitForFunction(() => activeJob?.started);
    return request;
  };
  const pageMessage = (jobId, index = 0, item = first, format = 'PNG', data) => {
    const exportColorProfile = profilesByJob.get(jobId) || 'SRGB';
    return { type: 'export-page', jobId, index, frame: item, format, data: data ?? (exportColorProfile === 'DISPLAY_P3_V4' ? p3Png : png), exportColorProfile, outputColorMode: modesByJob.get(jobId) || 'RGB' };
  };
  return { page, frame, post, messages, waitMessage, openSettings, start, pageMessage, downloads, errors };
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

test('selection updates preserve sorting, export every listed frame, render names safely, and never unlock an active export', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const frames = [{ ...first, id: 'ten', name: 'Page 10' }, { ...first, id: 'two', name: 'Page 2' }];
  await h.post({ type: 'frames-updated', frames, connections: [], justAdded: frames.map(item => item.id) });
  await h.frame.locator('#sort-select').selectOption('az', { force: true });
  const malicious = { ...first, id: 'literal', name: '<img src=x onerror="window.injected=true">', parent: '<svg onload=alert(1)>' };
  await h.post({ type: 'frames-updated', frames: [...frames, malicious], connections: [], justAdded: ['literal'] });
  await h.frame.waitForFunction(() => allFrames.length === 3);
  assert.deepEqual(await h.frame.locator('.frame-item').evaluateAll(items => items.map(item => item.dataset.frameId)), ['two', 'ten', 'literal']);
  assert.equal(await h.frame.locator('.frame-checkbox').count(), 0, 'listed frames do not use inclusion toggles');
  assert.equal(await h.frame.locator('.frame-name img, .frame-name svg').count(), 0);
  assert.equal(await h.frame.evaluate(() => window.injected), undefined);
  assert.equal(await h.frame.locator('[data-frame-id="literal"] .frame-name').textContent(), malicious.name);
  await h.openSettings();
  await h.frame.locator('#export-btn').click();
  const request = await h.waitMessage('export-pdf');
  assert.deepEqual(request.selectedFrames, ['two', 'ten', 'literal']);
  await h.post({ type: 'export-start', jobId: request.jobId, frames: [frames[1], frames[0], malicious], connections: [], exportColorProfile: 'SRGB', outputColorMode: 'RGB' });
  await h.frame.waitForFunction(() => activeJob?.started);
  await h.post({ type: 'frames-updated', frames: [...frames, malicious, { ...first, id: 'new' }], connections: [], justAdded: ['new'] });
  await h.post({ type: 'selection-changed', selectedFrameIds: ['ten'], selectedFrameNames: ['Page 10'] });
  await h.frame.waitForFunction(() => deferredFrames !== null);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  assert.equal(await h.frame.locator('#sort-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#quality-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#cancel-btn').isEnabled(), true);
  assert.equal(await h.frame.locator('#back-btn').isDisabled(), true);
  await h.post({ type: 'export-error', jobId: request.jobId, message: 'Test ended' });
  await h.frame.waitForFunction(() => activeJob === null);
  assert.deepEqual(await h.frame.locator('.frame-item').evaluateAll(items => items.map(item => item.dataset.frameId)), ['two', 'ten', 'literal', 'new']);
  assert.equal(await h.frame.locator('.frame-checkbox').count(), 0, 'listed frames do not use inclusion toggles');
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

test('color choices default to the Figma file and preserve concrete or legacy resolution per job', { timeout: 20000 }, async t => {
  for (const [choice, resolved] of [['SRGB', 'SRGB'], ['DISPLAY_P3_V4', 'DISPLAY_P3_V4'], ['DOCUMENT', 'DISPLAY_P3_V4'], ['DOCUMENT', 'SRGB'], ['DOCUMENT', 'DOCUMENT']]) {
    const h = await harness(t);
    assert.equal(await h.frame.locator('#color-profile').inputValue(), 'DOCUMENT', 'the file profile is the default');
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

test('export initialization rejects unsupported or contradictory color profiles', { timeout: 15000 }, async t => {
  for (const [choice, resolved] of [['SRGB', 'DISPLAY_P3_V4'], ['SRGB', 'DOCUMENT'], ['DOCUMENT', 'LEGACY'], ['DOCUMENT', undefined]]) {
    const h = await harness(t);
    await h.post({ type: 'frames-updated', frames: [first], connections: [], justAdded: [first.id] });
    await h.openSettings();
    await h.frame.locator('#color-profile').selectOption(choice, { force: true });
    await h.frame.locator('#export-btn').click();
    const { jobId } = await h.waitMessage('export-pdf');
    await h.post({ type: 'export-start', jobId, frames: [first], connections: [], exportColorProfile: resolved, outputColorMode: 'RGB' });
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

test('Vector CMYK retains image resolution controls and remembers separate raster settings', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.post({ type: 'frames-updated', frames: [first], connections: [] });
  await h.openSettings();
  assert.equal(await h.frame.locator('#export-vector').isChecked(), true);
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'DOCUMENT');
  assert.equal(await h.frame.locator('[role="radiogroup"][aria-label="Type"]').evaluate(element => Boolean(element.compareDocumentPosition(document.getElementById('color-profile')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '72');
  assert.equal(await h.frame.locator('#quality-row').isVisible(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').isEnabled(), true);
  await h.frame.locator('#vector-image-dpi').selectOption('144', { force: true });
  await h.frame.locator('label[for="export-raster"]').click();
  await h.frame.locator('#raster-format').selectOption('JPG', { force: true });
  await h.frame.locator('#quality-select').selectOption('print-high', { force: true });
  await h.frame.locator('#fit-oversized').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.frame.locator('label[for="export-vector"]').click();
  await h.frame.locator('#color-profile').selectOption('CMYK', { force: true });
  assert.equal(await h.frame.locator('[role="radiogroup"][aria-label="Type"]').isVisible(), true);
  for (const id of ['export-vector', 'export-raster']) assert.equal(await h.frame.locator(`#${id}`).isEnabled(), true);
  assert.equal(await h.frame.locator('#export-vector').isChecked(), true, 'choosing CMYK does not switch the format');
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  assert.equal(await h.frame.locator('#color-profile-compatibility').textContent(), '');
  assert.match(await h.frame.locator('#export-help').textContent(), /never automatically rasterized/);
  assert.match(await h.frame.locator('#cmyk-format-help').textContent(), /experimental/);
  for (const id of ['quality-setting', 'fit-oversized-setting', 'raster-format-setting', 'compression-help']) assert.equal(await h.frame.locator(`#${id}`).isVisible(), false);
  for (const id of ['quality-select', 'fit-oversized', 'raster-format']) assert.equal(await h.frame.locator(`#${id}`).isDisabled(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').isEnabled(), true);
  assert.equal(await h.frame.locator('#quality-row').isVisible(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').isEnabled(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '144');
  await h.frame.locator('label[for="export-raster"]').click();
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'CMYK');
  assert.equal(await h.frame.locator('#quality-row').isVisible(), true);
  assert.equal(await h.frame.locator('#quality-select').isEnabled(), true);
  assert.equal(await h.frame.locator('#vector-resolution-setting').isVisible(), false);
  assert.equal(await h.frame.locator('#fit-oversized-setting').isVisible(), true);
  assert.match(await h.frame.locator('#cmyk-format-help').textContent(), /8 million pixels/);
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  // Native radio keyboard navigation updates the same controls without changing profile.
  await h.frame.locator('#export-raster').focus(); await h.page.keyboard.press('ArrowLeft');
  assert.equal(await h.frame.locator('#export-vector').isChecked(), true);
  assert.equal(await h.frame.locator('#quality-setting').isVisible(), false);
  await h.frame.locator('#color-profile').selectOption('DOCUMENT', { force: true });
  assert.equal(await h.frame.locator('#raster-format').inputValue(), 'JPG');
  assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-high');
  assert.equal(await h.frame.locator('#fit-oversized').isChecked(), true);
  assert.equal(await h.frame.locator('#quality-setting').isVisible(), false);
  for (const id of ['quality-row', 'fit-oversized-setting', 'raster-format-setting']) assert.equal(await h.frame.locator(`#${id}`).isVisible(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '144');
  assert.deepEqual(h.errors, []);
});

test('custom CMYK requires a readable bounded ICC file and rejects an invalid profile before contacting Figma', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.post({ type: 'frames-updated', frames: [first], connections: [] });
  await h.openSettings();
  await h.frame.locator('label[for="export-raster"]').click();
  await h.frame.locator('#color-profile').selectOption('CMYK', { force: true });
  assert.equal(await h.frame.locator('#cmyk-settings').isVisible(), true);
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true, 'the bundled default is ready without an upload');
  await h.frame.locator('#cmyk-profile-source').selectOption('CUSTOM', { force: true });
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.frame.evaluate(() => startExport());
  assert.match(await h.frame.locator('#status-title').textContent(), /CMYK ICC profile/);
  for (const file of [
    { name: 'not-a-profile.txt', buffer: Buffer.from([1, 2, 3]) },
    { name: 'empty.icc', buffer: Buffer.alloc(0) },
    { name: 'too-large.icc', buffer: Buffer.alloc(16 * 1024 * 1024 + 1) }
  ]) {
    await h.frame.locator('#cmyk-profile').setInputFiles({ ...file, mimeType: 'application/vnd.iccprofile' });
    assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
    assert.match(await h.frame.locator('#cmyk-profile-status').textContent(), /non-empty.*16 MiB/);
  }
  await h.frame.locator('#cmyk-profile').setInputFiles({ name: 'invalid.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from([1, 2, 3]) });
  await h.frame.waitForFunction(() => selectedCmykProfile && !readingCmykProfile);
  await h.frame.locator('#export-btn').click();
  await h.frame.waitForFunction(() => activeJob === null && document.getElementById('status-title').textContent.includes('Export failed'));
  assert.equal((await h.messages('export-pdf')).length, 0);
  assert.equal((await h.messages('export-failed')).length, 0);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.equal(await h.frame.locator('#cmyk-profile').isEnabled(), true);
  assert.deepEqual(h.errors, []);
});

test('cancelling CMYK preparation waits for cleanup, freezes uploaded bytes, and never starts the backend', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.post({ type: 'frames-updated', frames: [first], connections: [] });
  await h.openSettings();
  await h.frame.locator('label[for="export-raster"]').click();
  await h.frame.locator('#color-profile').selectOption('CMYK', { force: true });
  await h.frame.locator('#cmyk-profile-source').selectOption('CUSTOM', { force: true });
  await h.frame.locator('#cmyk-profile').setInputFiles({ name: 'printer.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from([1, 2, 3]) });
  await h.frame.waitForFunction(() => selectedCmykProfile && !readingCmykProfile);
  await h.frame.evaluate(() => {
    window.closeCalls = 0;
    createCmykExporter = () => ({ prepare: bytes => new Promise(resolve => {
      window.preparingBytes = bytes;
      window.finishPrepare = () => resolve({ close() { window.closeCalls++; } });
    }) });
  });
  await h.frame.locator('#export-btn').click();
  await h.frame.waitForFunction(() => typeof window.finishPrepare === 'function');
  await h.frame.evaluate(() => { selectedCmykProfile.bytes[0] = 99; });
  assert.deepEqual(await h.frame.evaluate(() => [...window.preparingBytes]), [1, 2, 3], 'this job owns a snapshot of the uploaded profile');
  for (const selector of ['#cmyk-profile', '#cmyk-profile-source', '#color-profile', '#output-mode', '#quality-select', '#export-vector', '#export-raster']) assert.equal(await h.frame.locator(selector).isDisabled(), true, selector);
  assert.equal((await h.messages('export-pdf')).length, 0, 'profile preparation precedes all backend export work');
  await h.frame.locator('#cancel-btn').click();
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true, 'preparation must finish before another job starts');
  assert.equal((await h.messages('export-cancel')).length, 0, 'there is no backend job to cancel yet');
  await h.frame.evaluate(() => window.finishPrepare());
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 1);
  assert.equal((await h.messages('export-pdf')).length, 0);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  const next = await h.start([first], { colorProfile: 'SRGB' });
  assert.equal(next.colorProfile, 'SRGB');
  assert.deepEqual(h.errors, []);
});

async function stubCmykSession(frame, { deferredEmbed = false } = {}) {
  // Lifecycle-only substitute: actual CMYK samples and ICC output are verified by
  // the real-engine test below and the conversion/assembly suites.
  await frame.evaluate(deferred => {
    window.prepareCalls = 0; window.closeCalls = 0; window.embedModes = [];
    createCmykExporter = () => ({ prepare: async () => {
      window.prepareCalls++;
      return {
        async embedPng(pdf, bytes, options) {
          window.embedModes.push({ mode: activeJob.outputColorMode, active: options.stillActive() });
          if (deferred) await new Promise(resolve => { window.finishConversion = resolve; });
          window.lastStillActive = options.stillActive();
          const image = await pdf.embedPng(bytes);
          return { image, width: image.width, height: image.height };
        },
        close() { window.closeCalls++; }
      };
    } });
  }, deferredEmbed);
}

test('Vector CMYK rejects wrong formats, corrupt PDFs, geometry and conversion failures without raster retries', { timeout: 25000 }, async t => {
  for (const failureKind of ['format', 'corrupt', 'dimensions', 'conversion', 'copy']) {
    const h = await harness(t);
    await stubCmykSession(h.frame);
    const item = failureKind === 'dimensions' ? { ...first, width: 601 } : first;
    const { jobId } = await h.start([item], { exportType: 'vector', colorProfile: 'CMYK', iccBuffer: [1, 2, 3] });
    await h.frame.evaluate(kind => {
      window.vectorCalls = 0;
      createVectorCmykConverter = () => ({ convertPage: async () => {
        window.vectorCalls++;
        if (kind === 'conversion') throw new Error('Unsupported test PDF content');
        return { warnings: [] };
      } });
      if (kind === 'copy') activeJob.pdf.copyPages = async () => { throw new Error('Cannot copy test PDF'); };
    }, failureKind);
    await h.post(h.pageMessage(jobId, 0, item, failureKind === 'format' ? 'PNG' : 'PDF', failureKind === 'corrupt' ? [1, 2, 3] : nativePdf));
    const failure = await h.waitMessage('export-failed', { jobId });
    assert.match(failure.message, /Choose Rasterized/);
    assert.equal((await h.messages('page-ack')).length, 0, 'no fallback or success acknowledgement');
    assert.equal(await h.frame.evaluate(() => activeJob.nextIndex), 0);
    assert.equal(await h.frame.evaluate(() => activeJob.pdf.getPageCount()), 0);
    assert.equal(await h.frame.evaluate(() => window.vectorCalls), ['conversion', 'copy'].includes(failureKind) ? 1 : 0);
    await h.post({ type: 'export-error', jobId, error: failure.message });
    await h.frame.waitForFunction(() => activeJob === null);
    assert.equal(await h.frame.evaluate(() => window.closeCalls), 1);
    assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
    assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
    assert.deepEqual(h.errors, []);
  }
});

test('cancelling vector CMYK conversion discards converted data and closes the session after it settles', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await stubCmykSession(h.frame);
  const { jobId } = await h.start([first], { exportType: 'vector', colorProfile: 'CMYK', iccBuffer: [1, 2, 3] });
  await h.frame.evaluate(() => {
    createVectorCmykConverter = () => ({ convertPage: async (pdf, page, session, options) => {
      window.vectorSessionMatches = session === activeJob.cmykSession;
      await new Promise(resolve => { window.finishVectorConversion = resolve; });
      window.vectorStillActive = options.stillActive();
      return { warnings: [] };
    } });
  });
  await h.post(h.pageMessage(jobId, 0, first, 'PDF', nativePdf));
  await h.frame.waitForFunction(() => typeof window.finishVectorConversion === 'function');
  await h.frame.locator('#cancel-btn').click();
  await h.waitMessage('export-cancel', { jobId });
  await h.post({ type: 'export-cancelled', jobId });
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 0);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.frame.evaluate(() => window.finishVectorConversion());
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.vectorSessionMatches), true);
  assert.equal(await h.frame.evaluate(() => window.vectorStillActive), false);
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 1);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.equal((await h.messages('page-ack')).length, 0);
  assert.deepEqual(h.errors, []);
});

test('CMYK preserves format choices and uses one conversion session across parts until final download', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await stubCmykSession(h.frame);
  const frames = [first, { ...first, id: 'second', name: 'Page 2' }];
  const links = [{ source: 'prototype', type: 'internal', fromFrameId: first.id, toFrameId: 'second', elementBounds: { x: 10, y: 20, width: 30, height: 40 } }];
  const request = await h.start(frames, { pagesPerPart: 1, rasterFormat: 'JPG', exportType: 'raster', colorProfile: 'CMYK', iccBuffer: [1, 2, 3], links });
  const { jobId } = request;
  assert.equal(request.colorProfile, 'CMYK');
  assert.equal(request.exportType, 'raster');
  assert.equal(request.rasterFormat, 'PNG');
  assert.equal(await h.frame.locator('#export-raster').isChecked(), true, 'the selected format matches the export');
  assert.equal(await h.frame.locator('#export-vector').isChecked(), false);
  assert.equal(await h.frame.locator('#raster-format').inputValue(), 'JPG');
  assert.equal(await h.frame.locator('[role="radiogroup"][aria-label="Type"]').isVisible(), true);
  assert.equal(await h.frame.locator('#raster-format-setting').isVisible(), false);
  assert.deepEqual(await h.frame.evaluate(() => ({ mode: activeJob.outputColorMode, profile: activeJob.exportColorProfile, writable: Object.getOwnPropertyDescriptor(activeJob, 'outputColorMode').writable })), { mode: 'CMYK', profile: 'SRGB', writable: false });
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('part-ready', { jobId });
  await h.frame.waitForFunction(() => activeJob?.awaitingContinue);
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 0, 'the converter stays alive between parts');
  assert.equal(await h.frame.locator('#cmyk-profile').isDisabled(), true);
  await h.frame.locator('#continue-btn').click();
  await h.waitMessage('page-ack', { jobId, index: 0 });
  await h.post(h.pageMessage(jobId, 1, frames[1]));
  await h.waitMessage('page-ack', { jobId, index: 1 });
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  assert.deepEqual(await h.frame.evaluate(() => ({ prepared: window.prepareCalls, closed: window.closeCalls, embeds: window.embedModes, downloads: window.downloadClicks })), { prepared: 1, closed: 1, embeds: [{ mode: 'CMYK', active: true }, { mode: 'CMYK', active: true }], downloads: 2 });
  const firstPart = await PDFLib.PDFDocument.load(fs.readFileSync(await h.downloads[0].path()));
  const annotation = firstPart.getPage(0).node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).lookup(0, PDFLib.PDFDict);
  assert.equal(annotation.lookup(PDFLib.PDFName.of('A'), PDFLib.PDFDict).get(PDFLib.PDFName.of('S')).toString(), '/GoToR');
  await h.frame.locator('#color-profile').selectOption('DOCUMENT', { force: true });
  assert.equal(await h.frame.locator('#export-vector').isEnabled(), true);
  assert.equal(await h.frame.locator('#export-raster').isChecked(), true, 'changing profile keeps the chosen format');
  await h.frame.locator('label[for="export-vector"]').click();
  assert.equal(await h.frame.locator('#export-vector').isChecked(), true);
  assert.equal(await h.frame.locator('#raster-format').inputValue(), 'JPG');
  assert.equal(await h.frame.locator('[role="radiogroup"][aria-label="Type"]').isVisible(), true);
  assert.equal(await h.frame.locator('#raster-format-setting').isVisible(), true);
  assert.deepEqual(h.errors, []);
});

test('cancelling an in-flight CMYK conversion closes its session only after conversion settles', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await stubCmykSession(h.frame, { deferredEmbed: true });
  const { jobId } = await h.start([first], { exportType: 'raster', colorProfile: 'CMYK', iccBuffer: [1, 2, 3] });
  await h.post(h.pageMessage(jobId));
  await h.frame.waitForFunction(() => typeof window.finishConversion === 'function');
  await h.frame.locator('#cancel-btn').click();
  await h.waitMessage('export-cancel', { jobId });
  await h.post({ type: 'export-cancelled', jobId });
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 0);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.frame.evaluate(() => window.finishConversion());
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.lastStillActive), false);
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 1);
  assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
  assert.equal((await h.messages('page-ack')).length, 0);
  assert.deepEqual(h.errors, []);
});

test('missing or inconsistent output color modes fail before page conversion', { timeout: 15000 }, async t => {
  for (const phase of ['start', 'page']) {
    const h = await harness(t);
    let jobId;
    if (phase === 'start') {
      await h.post({ type: 'frames-updated', frames: [first], connections: [] });
      await h.openSettings();
      await h.frame.locator('#export-btn').click();
      ({ jobId } = await h.waitMessage('export-pdf'));
      await h.post({ type: 'export-start', jobId, frames: [first], connections: [], exportColorProfile: 'SRGB' });
    } else {
      ({ jobId } = await h.start());
      await h.post({ ...h.pageMessage(jobId), outputColorMode: 'CMYK' });
    }
    const failure = await h.waitMessage('export-failed', { jobId });
    assert.match(failure.message, /color mode differs/);
    assert.equal(await h.frame.evaluate(() => activeJob.nextIndex), 0);
    assert.equal((await h.messages('page-ack')).length, 0);
    await h.post({ type: 'export-error', jobId, error: failure.message });
    await h.frame.waitForFunction(() => activeJob === null);
    assert.equal(await h.frame.evaluate(() => window.downloadClicks), 0);
    assert.deepEqual(h.errors, []);
  }
});

test('legacy DOCUMENT exports preserve the per-page embedded profile through download', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const { jobId } = await h.start([first], { resolvedProfile: 'DOCUMENT' });
  await h.post(h.pageMessage(jobId, 0, first, 'PNG', p3Png));
  await h.waitMessage('page-ack', { jobId });
  const downloaded = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  const document = await PDFLib.PDFDocument.load(fs.readFileSync(await (await downloaded).path()));
  const images = document.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFLib.PDFRawStream && object.dict.get(PDFLib.PDFName.of('Subtype'))?.toString() === '/Image');
  const image = images.find(object => object.dict.get(PDFLib.PDFName.of('ColorSpace')) instanceof PDFLib.PDFArray);
  const colorSpace = image.dict.lookup(PDFLib.PDFName.of('ColorSpace'), PDFLib.PDFArray);
  assert.equal(colorSpace.get(0).toString(), '/ICCBased');
  assert.equal(document.context.lookup(colorSpace.get(1)).dict.get(PDFLib.PDFName.of('N')).asNumber(), 3);
  assert.deepEqual(h.errors, []);
});

test('the bundled offline CMYK engine converts an uploaded printer profile and downloads a four-channel PDF', { timeout: 20000 }, async t => {
  const h = await harness(t);
  const iccBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/color-profiles/synthetic-cmyk-test-only.icc'));
  const links = [{ source: 'prototype', type: 'external', fromFrameId: first.id, toUrl: 'https://example.com', elementBounds: { x: 10, y: 20, width: 30, height: 40 } }];
  const { jobId } = await h.start([first], { exportType: 'raster', colorProfile: 'CMYK', iccBuffer, links });
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('page-ack', { jobId });
  const downloaded = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  const document = await PDFLib.PDFDocument.load(fs.readFileSync(await (await downloaded).path()));
  const image = document.context.enumerateIndirectObjects().map(([, object]) => object).find(object => object instanceof PDFLib.PDFRawStream && object.dict.get(PDFLib.PDFName.of('Subtype'))?.toString() === '/Image');
  const colorSpace = image.dict.lookup(PDFLib.PDFName.of('ColorSpace'), PDFLib.PDFArray);
  assert.equal(colorSpace.get(0).toString(), '/ICCBased');
  const embeddedProfile = document.context.lookup(colorSpace.get(1));
  assert.equal(embeddedProfile.dict.get(PDFLib.PDFName.of('N')).asNumber(), 4);
  assert.deepEqual(Buffer.from(PDFLib.decodePDFRawStream(embeddedProfile).decode()), iccBuffer);
  assert.equal(image.dict.has(PDFLib.PDFName.of('SMask')), false, 'CMYK pages are flattened onto white');
  assert.equal(document.getPage(0).node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).size(), 1);
  assert.equal(await h.frame.evaluate(() => activeJob), null);
  assert.deepEqual(h.errors, []);
});

test('real vector CMYK conversion preserves native Figma text, paths and links across PDF parts', { timeout: 30000 }, async t => {
  const h = await harness(t);
  const iccBuffer = fs.readFileSync(path.join(__dirname, 'fixtures/color-profiles/synthetic-cmyk-test-only.icc'));
  const frames = [first, { ...first, id: 'second', name: first.name }];
  const links = [{ source: 'prototype', type: 'internal', fromFrameId: first.id, toFrameId: 'second', elementBounds: { x: 10, y: 20, width: 30, height: 40 } }];
  const requests = [];
  h.page.on('request', request => requests.push(request.url()));
  await h.frame.evaluate(() => {
    window.vectorPrepareCalls = 0; window.vectorCloseCalls = 0;
    const factory = createCmykExporter;
    createCmykExporter = (...args) => {
      const exporter = factory(...args);
      return { async prepare(bytes) {
        window.vectorPrepareCalls++;
        const session = await exporter.prepare(bytes), close = session.close.bind(session);
        session.close = () => { window.vectorCloseCalls++; close(); };
        return session;
      } };
    };
    pdfColorManagement.preserveNativeColorProfile = async () => { throw new Error('Converted CMYK must not reattach the RGB source profile'); };
  });
  const request = await h.start(frames, { exportType: 'vector', colorProfile: 'CMYK', iccBuffer, pagesPerPart: 1, links });
  const { jobId } = request;
  assert.equal(request.exportType, 'vector'); assert.equal(request.colorProfile, 'CMYK');
  for (const id of ['export-vector', 'export-raster', 'color-profile', 'cmyk-profile-source']) assert.equal(await h.frame.locator(`#${id}`).isDisabled(), true);
  await h.post(h.pageMessage(jobId, 0, frames[0], 'PDF', nativePdf));
  await h.waitMessage('part-ready', { jobId, index: 0 });
  await h.frame.waitForFunction(() => activeJob?.awaitingContinue);
  assert.deepEqual(await h.frame.evaluate(() => ({ pdf: activeJob.pdf, pages: activeJob.pages.length, closed: window.vectorCloseCalls })), { pdf: null, pages: 0, closed: 0 });
  await h.frame.locator('#continue-btn').click();
  await h.waitMessage('page-ack', { jobId, index: 0 });
  await h.post(h.pageMessage(jobId, 1, frames[1], 'PDF', nativePdf));
  await h.waitMessage('page-ack', { jobId, index: 1 });
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  assert.equal(h.downloads.length, 2);
  assert.equal((await h.messages('page-ack')).some(message => message.fallback), false);
  const source = await PDFLib.PDFDocument.load(new Uint8Array(nativePdf));
  const { PDFName, PDFArray, PDFDict, PDFRawStream } = PDFLib;
  const uriAnnotations = page => {
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    return Array.from({ length: annots.size() }, (_, index) => annots.lookup(index, PDFDict)).flatMap(annotation => {
      const action = annotation.lookup(PDFName.of('A'), PDFDict);
      return action.get(PDFName.of('S')).toString() === '/URI'
        ? [{ uri: action.lookup(PDFName.of('URI')).decodeText(), rect: annotation.lookup(PDFName.of('Rect'), PDFArray).asArray().map(number => number.asNumber()) }]
        : [];
    });
  };
  const expectedAnnotations = uriAnnotations(source.getPage(0));
  const contentText = (document, page) => {
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => document.context.lookup(ref)) : [contents];
    return streams.map(stream => Buffer.from(PDFLib.decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
  };
  const expectedTextShows = contentText(source, source.getPage(0)).match(/\bT[Jj]\b/g)?.length || 0;
  assert.ok(expectedTextShows, 'the native fixture contains text-show operators');
  for (const [index, download] of h.downloads.entries()) {
    const document = await PDFLib.PDFDocument.load(fs.readFileSync(await download.path()));
    const page = document.getPage(0);
    assert.deepEqual(page.getSize(), { width: 600, height: 400 });
    assert.deepEqual(uriAnnotations(page), expectedAnnotations, 'all five native text-link rectangles survive exactly');
    const streams = document.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFRawStream);
    assert.equal(streams.some(stream => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'), false, 'native vector/text page is not replaced by an image');
    const profiles = streams.filter(stream => stream.dict.get(PDFName.of('N'))?.asNumber() === 4);
    assert.equal(profiles.length, 1, 'destination CMYK profile is embedded once per part');
    assert.deepEqual(Buffer.from(PDFLib.decodePDFRawStream(profiles[0]).decode()), iccBuffer);
    const operators = contentText(document, page);
    assert.match(operators, /\bBT\b/); assert.match(operators, /\bm\b/); assert.match(operators, /\bf\b/);
    assert.equal(operators.match(/\bT[Jj]\b/g)?.length || 0, expectedTextShows, 'all native text-show operators remain');
    assert.ok(page.node.Resources().lookup(PDFName.of('Font'), PDFDict).keys().length, 'native font resources remain');
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    assert.equal(annots.size(), index === 0 ? 6 : 5);
    if (index === 0) {
      const remote = annots.asArray().map(ref => document.context.lookup(ref, PDFDict)).map(annotation => annotation.lookup(PDFName.of('A'), PDFDict)).find(action => action.get(PDFName.of('S')).toString() === '/GoToR');
      assert.equal(remote.lookup(PDFName.of('F')).decodeText(), h.downloads[1].suggestedFilename());
      assert.equal(remote.lookup(PDFName.of('D'), PDFArray).get(0).asNumber(), 0);
    }
  }
  assert.deepEqual(await h.frame.evaluate(() => ({ prepared: window.vectorPrepareCalls, closed: window.vectorCloseCalls, job: activeJob })), { prepared: 1, closed: 1, job: null });
  assert.deepEqual(requests, [], 'vector conversion also works offline');
  assert.deepEqual(h.errors, []);
});

test('CMYK works offline with the bundled profile and no file upload', { timeout: 20000 }, async t => {
  const h = await harness(t);
  const requests = [];
  h.page.on('request', request => requests.push(request.url()));
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'DOCUMENT', 'the overall default still follows the Figma file');
  const expected = await h.frame.evaluate(() => {
    const first = getBundledCmykProfile();
    const original = first.bytes[0];
    first.bytes[0] ^= 255;
    const fresh = getBundledCmykProfile();
    if (fresh.bytes[0] !== original) throw new Error('Bundled profile bytes must not be shared mutable state');
    return { bytes: [...fresh.bytes], name: fresh.name };
  });
  const links = [{ source: 'prototype', type: 'external', fromFrameId: first.id, toUrl: 'https://example.com/bundled-cmyk', elementBounds: { x: 10, y: 20, width: 30, height: 40 } }];
  const { jobId } = await h.start([first], { exportType: 'raster', colorProfile: 'CMYK', links });
  assert.equal(await h.frame.locator('#cmyk-profile-source').inputValue(), 'BUNDLED');
  assert.equal(await h.frame.locator('#cmyk-profile').isVisible(), false);
  assert.equal(await h.frame.locator('#cmyk-profile-source').isDisabled(), true);
  assert.equal(await h.frame.evaluate(() => document.getElementById('cmyk-profile').files.length), 0);
  assert.equal(await h.frame.evaluate(() => activeJob.cmykProfileSource), 'BUNDLED');
  assert.equal(await h.frame.evaluate(() => activeJob.cmykProfileName), expected.name);
  await h.post(h.pageMessage(jobId));
  await h.waitMessage('page-ack', { jobId });
  const downloaded = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  const document = await PDFLib.PDFDocument.load(fs.readFileSync(await (await downloaded).path()));
  assert.deepEqual(document.getPage(0).getSize(), { width: 600, height: 400 });
  const image = document.context.enumerateIndirectObjects().map(([, object]) => object).find(object => object instanceof PDFLib.PDFRawStream && object.dict.get(PDFLib.PDFName.of('Subtype'))?.toString() === '/Image');
  const colorSpace = image.dict.lookup(PDFLib.PDFName.of('ColorSpace'), PDFLib.PDFArray);
  assert.equal(colorSpace.get(0).toString(), '/ICCBased');
  const profile = document.context.lookup(colorSpace.get(1));
  assert.equal(profile.dict.get(PDFLib.PDFName.of('N')).asNumber(), 4);
  assert.deepEqual([...PDFLib.decodePDFRawStream(profile).decode()], expected.bytes);
  assert.equal(PDFLib.decodePDFRawStream(image).decode().length, 4, 'the 1x1 fixture has four actual CMYK bytes');
  const annotation = document.getPage(0).node.lookup(PDFLib.PDFName.of('Annots'), PDFLib.PDFArray).lookup(0, PDFLib.PDFDict);
  assert.equal(annotation.lookup(PDFLib.PDFName.of('A'), PDFLib.PDFDict).lookup(PDFLib.PDFName.of('URI')).decodeText(), 'https://example.com/bundled-cmyk');
  assert.equal(await h.frame.locator('#cmyk-profile-source').isEnabled(), true);
  assert.deepEqual(requests, [], 'bundled conversion requires no network');
  assert.deepEqual(h.errors, []);
});

test('two converted vector pages in one PDF share one exact built-in CMYK profile', { timeout: 30000 }, async t => {
  const h = await harness(t);
  const frames = [first, { ...first, id: 'second' }];
  const profile = await h.frame.evaluate(() => [...getBundledCmykProfile().bytes]);
  const { jobId } = await h.start(frames, { exportType: 'vector', colorProfile: 'CMYK' });
  for (const [index, item] of frames.entries()) {
    await h.post(h.pageMessage(jobId, index, item, 'PDF', nativePdf));
    await h.waitMessage('page-ack', { jobId, index });
  }
  const downloaded = h.page.waitForEvent('download');
  await h.post({ type: 'export-complete', jobId });
  await h.waitMessage('export-finished', { jobId });
  const document = await PDFLib.PDFDocument.load(fs.readFileSync(await (await downloaded).path()));
  const { PDFName, PDFArray, PDFDict, PDFRawStream } = PDFLib;
  assert.equal(document.getPageCount(), 2);
  const profiles = document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('N'))?.asNumber() === 4);
  assert.equal(profiles.length, 1, 'duplicate and orphan CMYK ICC streams are removed before save');
  assert.deepEqual([...PDFLib.decodePDFRawStream(profiles[0][1]).decode()], profile);
  const canonicalRef = profiles[0][0].toString();
  for (const page of document.getPages()) {
    const spaces = page.node.Resources().lookup(PDFName.of('ColorSpace'), PDFDict);
    const cmykRefs = spaces.entries().map(([, value]) => document.context.lookup(value)).filter(space => space instanceof PDFArray && space.get(0).toString() === '/ICCBased')
      .map(space => space.get(1)).filter(ref => document.context.lookup(ref).dict.get(PDFName.of('N')).asNumber() === 4);
    assert.ok(cmykRefs.length, 'each page points at a CMYK color space');
    assert.ok(cmykRefs.every(ref => ref.toString() === canonicalRef), 'all page resources point to the one retained profile');
  }
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.errors, []);
});

test('switching back to bundled CMYK during a pending custom read cannot replace its profile', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.post({ type: 'frames-updated', frames: [first], connections: [] });
  await h.openSettings();
  await h.frame.locator('label[for="export-raster"]').click();
  await h.frame.locator('#color-profile').selectOption('CMYK', { force: true });
  await h.frame.locator('#cmyk-profile-source').selectOption('CUSTOM', { force: true });
  await h.frame.evaluate(() => {
    File.prototype.arrayBuffer = function () { return new Promise(resolve => { window.finishProfileRead = () => resolve(Uint8Array.of(1, 2, 3).buffer); }); };
  });
  await h.frame.locator('#cmyk-profile').setInputFiles({ name: 'slow.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from([1, 2, 3]) });
  await h.frame.waitForFunction(() => typeof window.finishProfileRead === 'function');
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.frame.locator('#cmyk-profile-source').selectOption('BUNDLED', { force: true });
  assert.equal(await h.frame.locator('#export-btn').isEnabled(), true);
  await h.frame.evaluate(() => window.finishProfileRead());
  await h.frame.waitForFunction(() => !readingCmykProfile);
  assert.equal(await h.frame.locator('#cmyk-profile-source').inputValue(), 'BUNDLED');
  await h.frame.evaluate(() => {
    window.closeCalls = 0;
    createCmykExporter = () => ({ prepare: bytes => new Promise(resolve => {
      const expected = getBundledCmykProfile().bytes;
      window.usedBundledBytes = bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
      window.finishPrepare = () => resolve({ close() { window.closeCalls++; } });
    }) });
  });
  await h.frame.locator('#export-btn').click();
  await h.frame.waitForFunction(() => typeof window.finishPrepare === 'function');
  assert.equal(await h.frame.evaluate(() => window.usedBundledBytes), true);
  assert.equal(await h.frame.locator('#cmyk-profile-source').isDisabled(), true);
  await h.frame.locator('#cancel-btn').click();
  await h.frame.evaluate(() => window.finishPrepare());
  await h.frame.waitForFunction(() => activeJob === null);
  assert.equal(await h.frame.evaluate(() => window.closeCalls), 1);
  assert.equal((await h.messages('export-pdf')).length, 0);
  assert.deepEqual(h.errors, []);
});

test('profile help opens with keyboard and explains Mac and Windows locations offline', { timeout: 15000 }, async t => {
  const h = await harness(t);
  const requests = [];
  h.page.on('request', request => requests.push(request.url()));
  await h.post({ type: 'frames-updated', frames: [first], connections: [] });
  await h.openSettings();
  await h.frame.locator('#color-profile').selectOption('CMYK', { force: true });
  const help = h.frame.locator('#cmyk-profile-help');
  const dialog = h.frame.locator('#profile-help-dialog');
  const toggle = h.frame.locator('#profile-help-toggle');
  assert.equal(await dialog.isVisible(), false);
  await toggle.focus();
  await h.page.keyboard.press('Enter');
  assert.equal(await dialog.evaluate(element => element.open), true);
  assert.equal(await help.isVisible(), true);
  const text = await help.textContent();
  for (const location of ['/Library/ColorSync/Profiles', '~/Library/ColorSync/Profiles', '/System/Library/ColorSync/Profiles', '%WINDIR%\\System32\\spool\\drivers\\color']) assert.ok(text.includes(location), location);
  assert.match(text, /\.icc/); assert.match(text, /\.icm/);
  assert.match(text, /CMYK/); assert.match(text, /RGB/); assert.match(text, /Downloads/);
  await h.page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(requests, []);
  assert.deepEqual(h.errors, []);
});
