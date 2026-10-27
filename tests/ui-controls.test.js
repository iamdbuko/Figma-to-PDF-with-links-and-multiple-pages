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
  const openSettings = async () => {
    const before = (await messages('export-pdf')).length;
    if (await frame.locator('#frames-screen').isVisible()) await frame.locator('#open-settings-btn').click();
    await frame.locator('#settings-screen').waitFor({ state: 'visible' });
    assert.equal((await messages('export-pdf')).length, before, 'opening settings must not start Figma rendering');
  };
  const choose = async (id, value) => {
    const button = frame.locator(`[data-setting="${id}"][data-value="${value}"]`);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
  };
  const chooseDpi = async value => {
    const button = frame.locator(`[data-dpi="${value}"]`);
    if (!await button.isVisible()) await frame.locator('#quality-more-btn').click();
    await button.click();
    assert.equal(await button.getAttribute(await button.getAttribute('role') === 'menuitemradio' ? 'aria-checked' : 'aria-pressed'), 'true');
    assert.equal(await frame.locator('#quality-more-menu').isVisible(), false);
  };
  const back = async () => {
    await frame.locator('#back-btn').click();
    await frame.locator('#frames-screen').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('#settings-screen').isVisible(), false);
  };
  const start = async () => {
    await openSettings();
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
  return { page, frame, post, messages, row, order, waitOrder, setFrames, openSettings, choose, chooseDpi, back, start, cancel };
}

test('natural A–Z and Z–A sorting keep equal-name order and export every listed frame', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.setFrames([
    makeFrame('ten', 'Page 10'), makeFrame('two-a', 'Page 2'), makeFrame('one', 'Page 1'),
    makeFrame('two-b', 'page 2'), makeFrame('two-c', 'PAGE 2')
  ]);
  await h.frame.locator('#sort-select').selectOption('az');
  assert.deepEqual(await h.order(), ['one', 'two-a', 'two-b', 'two-c', 'ten']);
  assert.equal(await h.frame.locator('#sort-select').inputValue(), 'none');
  // Establish a different tie order with an actual browser drag before sorting again.
  await h.row('two-c').dragTo(h.row('two-a'));
  await h.waitOrder(['one', 'two-c', 'two-a', 'two-b', 'ten']);
  await h.frame.locator('#sort-select').selectOption('za');
  assert.deepEqual(await h.order(), ['ten', 'two-c', 'two-a', 'two-b', 'one']);
  assert.equal(await h.frame.locator('.frame-checkbox').count(), 0);
  const { request } = await h.start();
  assert.deepEqual(request.frameOrder, ['ten', 'two-c', 'two-a', 'two-b', 'one']);
  assert.deepEqual(request.selectedFrames, request.frameOrder);
  await h.cancel(request.jobId);
  await h.back();
  await h.frame.locator('#sort-select').selectOption('az');
  assert.deepEqual(await h.order(), ['one', 'two-c', 'two-a', 'two-b', 'ten']);
});

test('physical dragging in both directions determines the order of all exported frames', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.setFrames(['a', 'b', 'c', 'd'].map(id => makeFrame(id, 'Repeated name')));
  await h.row('a').dragTo(h.row('c'));
  await h.waitOrder(['b', 'c', 'a', 'd']);
  await h.row('d').dragTo(h.row('b'));
  await h.waitOrder(['d', 'b', 'c', 'a']);
  // Figma selection highlighting must not exclude any listed frame.
  await h.post({ type: 'selection-changed', selectedFrameIds: ['a'] });
  await h.frame.waitForFunction(() => document.querySelector('[data-frame-id="a"]').classList.contains('selected-in-figma'));
  await h.row('b').click();
  assert.deepEqual(await h.order(), ['d', 'b', 'c', 'a'], 'clicking a row does not toggle export inclusion');
  const { request } = await h.start();
  assert.deepEqual(request.frameOrder, ['d', 'b', 'c', 'a']);
  assert.deepEqual(request.selectedFrames, request.frameOrder);
  assert.equal(await h.frame.locator('#sort-select').isDisabled(), true);
  assert.equal(await h.frame.locator('#clear-list-btn').isDisabled(), true);
  assert.equal(await h.frame.locator('#back-btn').isDisabled(), true);
  assert.equal(await h.frame.locator('[data-setting="color-profile"][data-value="CMYK"]').isDisabled(), true);
  assert.equal(await h.frame.locator('[data-dpi="72"]').isDisabled(), true);
  assert.equal(await h.frame.locator('#quality-more-btn').isDisabled(), true);
  assert.equal(await h.row('a').getAttribute('draggable'), 'false');
  await h.cancel(request.jobId);
  assert.equal(await h.row('a').getAttribute('draggable'), 'true');
  assert.equal(await h.frame.locator('.frame-checkbox').count(), 0);
});

test('context removal, backend refresh, re-add and clear preserve the exact listed frame IDs', { timeout: 20000 }, async t => {
  const h = await harness(t);
  const a = makeFrame('a', 'Same name'), b = makeFrame('b', 'Same name'), c = makeFrame('c', 'Same name');
  await h.setFrames([a, b, c]);
  await h.row('b').click({ button: 'right' });
  await h.frame.locator('#frame-context-menu').waitFor({ state: 'visible' });
  await h.frame.locator('#remove-frame-action').click();
  await h.waitOrder(['a', 'c']);
  await h.page.waitForFunction(() => received.some(message => message.type === 'remove-frame'));
  assert.deepEqual(await h.messages('remove-frame'), [{ type: 'remove-frame', frameId: 'b' }]);
  await h.setFrames([a, c]);
  // The backend may return a different source order; retained UI order is authoritative.
  await h.setFrames([b, c, a], ['a', 'c', 'b']);
  const first = await h.start();
  assert.deepEqual(first.request.frameOrder, ['a', 'c', 'b']);
  assert.deepEqual(first.request.selectedFrames, ['a', 'c', 'b']);
  await h.cancel(first.request.jobId);
  await h.back();
  await h.frame.locator('#clear-list-btn').click();
  await h.waitOrder([]);
  await h.page.waitForFunction(() => received.some(message => message.type === 'clear-list'));
  assert.deepEqual(await h.messages('clear-list'), [{ type: 'clear-list' }]);
  await h.setFrames([]);
  assert.equal(await h.frame.locator('#empty-state').isVisible(), true);
  assert.equal(await h.frame.locator('#open-settings-btn').isDisabled(), true);
  await h.setFrames([a]);
  assert.equal(await h.frame.locator('#open-settings-btn').isEnabled(), true);
  const second = await h.start();
  assert.deepEqual(second.request.frameOrder, ['a']);
  assert.deepEqual(second.request.selectedFrames, ['a']);
  await h.cancel(second.request.jobId);
});

test('keyboard context removal and Delete remove rows while Escape leaves the list unchanged', { timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.setFrames(['a', 'b', 'c'].map(id => makeFrame(id)));
  await h.row('b').focus();
  await h.page.keyboard.press('Shift+F10');
  await h.frame.locator('#frame-context-menu').waitFor({ state: 'visible' });
  await h.frame.locator('#remove-frame-action').click();
  await h.waitOrder(['a', 'c']);
  await h.row('a').click({ button: 'right' });
  await h.page.keyboard.press('Escape');
  assert.equal(await h.frame.locator('#frame-context-menu').isVisible(), false);
  assert.deepEqual(await h.order(), ['a', 'c']);
  await h.row('c').focus(); await h.page.keyboard.press('Delete');
  await h.waitOrder(['a']);
  await h.page.waitForFunction(() => received.filter(message => message.type === 'remove-frame').length === 2);
  assert.deepEqual(await h.messages('remove-frame'), [{ type: 'remove-frame', frameId: 'b' }, { type: 'remove-frame', frameId: 'c' }]);
  const { request } = await h.start();
  assert.deepEqual(request.selectedFrames, ['a']);
  await h.cancel(request.jobId);
});

test('Vector image DPI and Raster page quality survive RGB/CMYK switches without changing each other', { timeout: 30000 }, async t => {
  const h = await harness(t);
  await h.setFrames([makeFrame('page')]);
  await h.openSettings();
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'DOCUMENT');
  assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '72');
  await h.chooseDpi('216');
  await h.frame.locator('label[for="export-raster"]').click();
  await h.chooseDpi('288');
  await h.choose('raster-format', 'JPG');
  await h.choose('fit-oversized', 'true');
  await h.frame.locator('label[for="export-vector"]').click();
  assert.equal(await h.frame.locator('#quality-row').isVisible(), true);
  assert.equal(await h.frame.locator('#vector-image-dpi').isEnabled(), true);
  assert.equal(await h.frame.locator('#quality-setting').isVisible(), false);
  let run = await h.start();
  assert.equal(run.imageDpi, 216);
  assert.equal(run.request.qualityScale, 3, 'Vector fallback scale follows its image DPI, not the retained Raster preset');
  assert.equal(run.request.exportType, 'vector');
  assert.equal(run.request.rasterFormat, 'JPG');
  await h.cancel(run.request.jobId);

  await h.choose('color-profile', 'CMYK');
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
  assert.equal(await h.frame.locator('#quality-row').isVisible(), true);
  assert.equal(await h.frame.locator('#quality-select').isEnabled(), true);
  assert.equal(await h.frame.locator('#vector-resolution-setting').isVisible(), false);
  run = await h.start();
  assert.equal(run.request.exportType, 'raster');
  assert.equal(run.request.colorProfile, 'CMYK');
  assert.equal(run.request.rasterFormat, 'PNG');
  assert.equal(run.request.qualityScale, 4);
  assert.equal(run.imageDpi, null);
  await h.cancel(run.request.jobId);

  await h.choose('color-profile', 'DISPLAY_P3_V4');
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
  await h.openSettings();
  await h.chooseDpi('144');
  await h.frame.locator('label[for="export-raster"]').click();
  for (const [quality, scale] of Object.entries({
    'screen-low': 0.5, 'screen-medium': 1, 'screen-high': 1.5,
    'print-low': 2, 'print-medium': 3, 'print-high': 4, 'print-highest': 4.17
  })) {
    await h.chooseDpi({ 'screen-low': '36', 'screen-medium': '72', 'screen-high': '108', 'print-low': '144', 'print-medium': '216', 'print-high': '288', 'print-highest': '300' }[quality]);
    const { request, imageDpi } = await h.start();
    assert.equal(request.quality, quality);
    assert.equal(request.qualityScale, scale);
    assert.equal(imageDpi, null);
    await h.cancel(request.jobId);
    assert.equal(await h.frame.locator('#vector-image-dpi').inputValue(), '144');
  }
  await h.frame.locator('label[for="export-vector"]').click();
  for (const dpi of ['original', '36', '72', '108', '144', '216', '288', '300']) {
    await h.chooseDpi(dpi);
    const { request, imageDpi } = await h.start();
    assert.equal(imageDpi, dpi === 'original' ? null : Number(dpi));
    assert.equal(request.qualityScale, dpi === 'original' ? 1 : Number(dpi) / 72);
    await h.cancel(request.jobId);
    assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-highest');
  }
});
