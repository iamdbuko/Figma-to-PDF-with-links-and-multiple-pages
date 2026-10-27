const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const makeFrame = (id, name = id) => ({ id, name, width: 600, height: 400, parent: 'Page' });
let browser;

test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function harness(t) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 600, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [], downloads = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download));
  await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
  // Exercise the offline production bundle in an isolated iframe, never a Figma account.
  await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe title="Plugin UI" style="width:420px;height:950px"></iframe>');
  const frame = page.frames().find(item => item !== page.mainFrame());
  await frame.setContent(fs.readFileSync(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8'));
  await frame.waitForFunction(() => typeof startExport === 'function', {}, { timeout: 5000 });
  assert.equal(await frame.evaluate(() => typeof PDFLib), 'object');
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  const messages = type => page.evaluate(type => received.filter(message => message.type === type), type);
  const row = id => frame.locator(`.frame-item[data-frame-id="${id}"]`);
  const order = () => frame.locator('.frame-item').evaluateAll(items => items.map(item => item.dataset.frameId));
  const waitOrder = ids => frame.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('.frame-item')].map(item => item.dataset.frameId)) === JSON.stringify(ids), ids, { timeout: 5000 });
  const setFrames = async (frames, expectedOrder = frames.map(item => item.id)) => {
    await post({ type: 'frames-updated', frames, connections: [], justAdded: [] });
    await waitOrder(expectedOrder);
  };
  const start = async () => {
    const count = (await messages('export-pdf')).length;
    await frame.locator('#export-btn').click();
    await page.waitForFunction(count => received.filter(message => message.type === 'export-pdf').length > count, count, { timeout: 15000 });
    const request = (await messages('export-pdf')).at(-1);
    const imageDpi = await frame.evaluate(() => activeJob.imageDpi);
    return { request, imageDpi };
  };
  const cancel = async jobId => {
    await frame.locator('#cancel-btn').click();
    await page.waitForFunction(jobId => received.some(message => message.type === 'export-cancel' && message.jobId === jobId), jobId);
    await post({ type: 'export-cancelled', jobId });
    await frame.waitForFunction(() => activeJob === null);
  };
  t.after(() => {
    assert.deepEqual(errors, [], 'controls must not produce browser errors');
    assert.deepEqual(network, [], 'the built UI must work entirely offline');
    assert.equal(downloads.length, 0, 'control-only exports are cancelled before rendering or downloading');
  });
  return { page, frame, post, messages, row, order, waitOrder, setFrames, start, cancel };
}

test('natural A–Z and Z–A sorting keep current order for equal names and preserve exclusions', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.setFrames([
    makeFrame('ten', 'Page 10'), makeFrame('two-a', 'Page 2'), makeFrame('one', 'Page 1'),
    makeFrame('two-b', 'page 2'), makeFrame('two-c', 'PAGE 2')
  ]);
  await h.row('two-b').locator('.frame-checkbox').uncheck();
  await h.frame.locator('#sort-select').selectOption('az');
  assert.deepEqual(await h.order(), ['one', 'two-a', 'two-b', 'two-c', 'ten']);
  assert.equal(await h.frame.locator('#sort-select').inputValue(), 'none');
  // Establish a different tie order with an actual browser drag before sorting again.
  await h.row('two-c').dragTo(h.row('two-a'));
  await h.waitOrder(['one', 'two-c', 'two-a', 'two-b', 'ten']);
  await h.frame.locator('#sort-select').selectOption('za');
  assert.deepEqual(await h.order(), ['ten', 'two-c', 'two-a', 'two-b', 'one']);
  assert.equal(await h.row('two-b').locator('.frame-checkbox').isChecked(), false);
  assert.equal(await h.frame.locator('#export-btn').textContent(), 'Export 4 Frames');
  const { request } = await h.start();
  assert.deepEqual(request.frameOrder, ['ten', 'two-c', 'two-a', 'two-b', 'one']);
  assert.deepEqual(request.selectedFrames, ['ten', 'two-c', 'two-a', 'one']);
  await h.cancel(request.jobId);
  await h.frame.locator('#sort-select').selectOption('az');
  assert.deepEqual(await h.order(), ['one', 'two-c', 'two-a', 'two-b', 'ten']);
});

test('dragging in both directions and checkbox inclusion determine the submitted export order', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.setFrames(['a', 'b', 'c', 'd'].map(id => makeFrame(id, 'Repeated name')));
  await h.row('a').dragTo(h.row('c'));
  await h.waitOrder(['b', 'c', 'a', 'd']);
  await h.row('d').dragTo(h.row('b'));
  await h.waitOrder(['d', 'b', 'c', 'a']);
  for (const id of ['a', 'b', 'c', 'd']) await h.row(id).locator('.frame-checkbox').uncheck();
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.row('c').locator('.frame-checkbox').check();
  await h.row('d').locator('.frame-checkbox').check();
  // Figma's selected-layer highlight is independent of export inclusion.
  await h.post({ type: 'selection-changed', selectedFrameIds: ['a'] });
  await h.row('a').locator('.frame-checkbox').waitFor();
  await h.frame.waitForFunction(() => document.querySelector('[data-frame-id="a"]').classList.contains('selected-in-figma'));
  assert.equal(await h.row('a').locator('.frame-checkbox').isChecked(), false);
  assert.equal(await h.row('d').locator('.frame-checkbox').isChecked(), true);
  const { request } = await h.start();
  assert.deepEqual(request.frameOrder, ['d', 'b', 'c', 'a']);
  assert.deepEqual(request.selectedFrames, ['d', 'c']);
  assert.equal(await h.frame.locator('#sort-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#clear-list-btn').isDisabled(), true);
  assert.equal(await h.row('a').getAttribute('draggable'), 'false');
  await h.cancel(request.jobId);
  assert.equal(await h.row('a').getAttribute('draggable'), 'true');
  assert.equal(await h.row('a').locator('.frame-checkbox').isChecked(), false);
});

test('remove, backend refresh, re-add and clear keep valid IDs and reset only newly added checkboxes', { timeout: 20000 }, async t => {
  const h = await harness(t);
  const a = makeFrame('a', 'Same name'), b = makeFrame('b', 'Same name'), c = makeFrame('c', 'Same name');
  await h.setFrames([a, b, c]);
  await h.row('a').locator('.frame-checkbox').uncheck();
  await h.row('b').locator('.remove-btn').click();
  await h.waitOrder(['a', 'c']);
  await h.page.waitForFunction(() => received.some(message => message.type === 'remove-frame'));
  assert.deepEqual(await h.messages('remove-frame'), [{ type: 'remove-frame', frameId: 'b' }]);
  await h.setFrames([a, c]);
  assert.equal(await h.row('a').locator('.frame-checkbox').isChecked(), false);
  // The backend may return a different source order; retained UI order is authoritative.
  await h.setFrames([b, c, a], ['a', 'c', 'b']);
  assert.equal(await h.row('b').locator('.frame-checkbox').isChecked(), true);
  assert.equal(await h.row('a').locator('.frame-checkbox').isChecked(), false);
  const first = await h.start();
  assert.deepEqual(first.request.frameOrder, ['a', 'c', 'b']);
  assert.deepEqual(first.request.selectedFrames, ['c', 'b']);
  await h.cancel(first.request.jobId);
  await h.frame.locator('#clear-list-btn').click();
  await h.waitOrder([]);
  await h.page.waitForFunction(() => received.some(message => message.type === 'clear-list'));
  assert.deepEqual(await h.messages('clear-list'), [{ type: 'clear-list' }]);
  await h.setFrames([]);
  assert.equal(await h.frame.locator('#empty-state').isVisible(), true);
  assert.equal(await h.frame.locator('#export-btn').isDisabled(), true);
  await h.setFrames([a]);
  assert.equal(await h.row('a').locator('.frame-checkbox').isChecked(), true);
  const second = await h.start();
  assert.deepEqual(second.request.frameOrder, ['a']);
  assert.deepEqual(second.request.selectedFrames, ['a']);
  await h.cancel(second.request.jobId);
});

test('Vector image DPI and Raster page quality survive RGB/CMYK switches without changing each other', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.setFrames([makeFrame('page')]);
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'DOCUMENT');
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), 'original');
  await h.frame.locator('#vector-image-dpi').selectOption('216');
  await h.frame.locator('label[for="export-raster"]').click();
  await h.frame.locator('#quality-select').selectOption('print-high');
  await h.frame.locator('#raster-format').selectOption('JPG');
  await h.frame.locator('#fit-oversized').check();
  await h.frame.locator('label[for="export-vector"]').click();
  assert.equal(await h.frame.locator('#vector-resolution-setting').isVisible(), true);
  assert.equal(await h.frame.locator('#quality-setting').isVisible(), false);
  let run = await h.start();
  assert.equal(run.imageDpi, 216);
  assert.equal(run.request.qualityScale, 3, 'Vector fallback scale follows its image DPI, not the retained Raster preset');
  assert.equal(run.request.exportType, 'vector');
  assert.equal(run.request.rasterFormat, 'JPG');
  await h.cancel(run.request.jobId);

  await h.frame.locator('#color-profile').selectOption('CMYK');
  assert.equal(await h.frame.locator('#export-vector').isChecked(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '216');
  assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-high');
  assert.equal(await h.frame.locator('#raster-format').inputValue(), 'JPG');
  assert.equal(await h.frame.locator('#raster-format').isDisabled(), true);
  assert.equal(await h.frame.locator('#fit-oversized').isChecked(), true);
  run = await h.start();
  assert.equal(run.request.exportType, 'vector');
  assert.equal(run.request.colorProfile, 'CMYK');
  assert.equal(run.request.rasterFormat, 'PNG');
  assert.equal(run.request.qualityScale, 3);
  assert.equal(run.imageDpi, 216);
  await h.cancel(run.request.jobId);

  await h.frame.locator('label[for="export-raster"]').click();
  assert.equal(await h.frame.locator('#quality-setting').isVisible(), true);
  assert.equal(await h.frame.locator('#vector-resolution-setting').isVisible(), false);
  run = await h.start();
  assert.equal(run.request.exportType, 'raster');
  assert.equal(run.request.colorProfile, 'CMYK');
  assert.equal(run.request.rasterFormat, 'PNG');
  assert.equal(run.request.qualityScale, 4);
  assert.equal(run.imageDpi, null);
  await h.cancel(run.request.jobId);

  await h.frame.locator('#color-profile').selectOption('DISPLAY_P3_V4');
  assert.equal(await h.frame.locator('#raster-format').inputValue(), 'JPG');
  assert.equal(await h.frame.locator('#raster-format').isDisabled(), false);
  assert.equal(await h.frame.locator('#fit-oversized').isChecked(), true);
  run = await h.start();
  assert.equal(run.request.colorProfile, 'DISPLAY_P3_V4');
  assert.equal(run.request.rasterFormat, 'JPG');
  assert.equal(run.request.qualityScale, 4);
  assert.equal(run.request.fitOversized, true);
  assert.equal(run.imageDpi, null);
  await h.cancel(run.request.jobId);
  await h.frame.locator('label[for="export-vector"]').click();
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '216');
  assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-high');
});

test('all visible resolution choices dispatch the advertised scale while preserving the inactive mode', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.setFrames([makeFrame('page')]);
  await h.frame.locator('#vector-image-dpi').selectOption('144');
  await h.frame.locator('label[for="export-raster"]').click();
  for (const [quality, scale] of Object.entries({
    'screen-low': 0.5, 'screen-medium': 1, 'screen-high': 1.5,
    'print-low': 2, 'print-medium': 3, 'print-high': 4, 'print-highest': 4.17
  })) {
    await h.frame.locator('#quality-select').selectOption(quality);
    const { request, imageDpi } = await h.start();
    assert.equal(request.quality, quality);
    assert.equal(request.qualityScale, scale);
    assert.equal(imageDpi, null);
    await h.cancel(request.jobId);
    assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '144');
  }
  await h.frame.locator('label[for="export-vector"]').click();
  for (const dpi of ['original', '36', '72', '108', '144', '216', '288', '300']) {
    await h.frame.locator('#vector-image-dpi').selectOption(dpi);
    const { request, imageDpi } = await h.start();
    assert.equal(imageDpi, dpi === 'original' ? null : Number(dpi));
    assert.equal(request.qualityScale, dpi === 'original' ? 1 : Number(dpi) / 72);
    await h.cancel(request.jobId);
    assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-highest');
  }
});
