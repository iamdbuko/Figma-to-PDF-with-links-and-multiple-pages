const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function harness(t, width = 520, height = 650) {
  const context = await browser.newContext({ viewport: { width, height } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style><script>window.received=[];addEventListener("message",e=>{if(e.data?.pluginMessage)received.push(e.data.pluginMessage)})</script><iframe></iframe>');
  const frame = page.frames()[1];
  await frame.setContent(fs.readFileSync(process.env.PDF_EXPORT_TEST_UI || path.join(__dirname, '../ui.html'), 'utf8'));
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  await post({ type: 'frames-updated', frames: [{ id: 'a', name: 'First frame', width: 500, height: 600 }, { id: 'b', name: 'Second frame', width: 500, height: 600 }], connections: [] });
  await frame.locator('.frame-item').last().waitFor();
  const choose = (setting, value) => frame.locator(`[data-setting="${setting}"][data-value="${value}"]`).click();
  t.after(() => assert.deepEqual(errors, []));
  return { page, frame, post, choose };
}

test('screens keep settings and frame changes without exporting on navigation', { timeout: 15000 }, async t => {
  const h = await harness(t);
  assert.equal(await h.frame.locator('#settings-screen').isVisible(), false);
  await h.frame.locator('#open-settings-btn').click();
  await h.choose('color-profile', 'CMYK'); await h.choose('cmyk-profile-source', 'CUSTOM');
  await h.frame.locator('#cmyk-profile').setInputFiles({ name: 'selected.icc', mimeType: 'application/vnd.iccprofile', buffer: Buffer.from([1, 2, 3]) });
  await h.frame.waitForFunction(() => selectedCmykProfile?.name === 'selected.icc');
  await h.choose('output-mode', 'parts'); await h.frame.locator('#pages-per-part').fill('7');
  await h.frame.locator('#back-btn').click();
  assert.equal(await h.frame.locator('#frames-screen').isVisible(), true);
  await h.post({ type: 'frames-updated', frames: [{ id: 'b', name: 'Second frame', width: 500, height: 600 }], connections: [] });
  await h.frame.waitForFunction(() => frameOrder.length === 1);
  await h.frame.locator('#open-settings-btn').click();
  assert.equal(await h.frame.locator('#color-profile').inputValue(), 'CMYK');
  assert.equal(await h.frame.locator('#pages-per-part').inputValue(), '7');
  assert.equal(await h.frame.locator('#profile-file-label').textContent(), 'selected.icc');
  assert.equal(await h.frame.evaluate(() => selectedCmykProfile.bytes.length), 3);
  assert.equal(await h.page.evaluate(() => received.filter(message => message.type === 'export-pdf').length), 0);
  await h.choose('color-profile', 'DOCUMENT');
  await h.frame.locator('#export-btn').click();
  await h.page.waitForFunction(() => received.some(message => message.type === 'export-pdf'));
  const request = await h.page.evaluate(() => received.find(message => message.type === 'export-pdf'));
  assert.deepEqual(request.selectedFrames, ['b']);
  assert.equal(request.qualityScale, 1);
  await h.frame.evaluate(() => navigateScreen('frames'));
  assert.equal(await h.frame.locator('#settings-screen').isVisible(), true, 'an active job cannot be hidden by navigation');
  assert.equal(await h.frame.locator('#cancel-btn').isVisible(), true);
  await h.frame.locator('#cancel-btn').click();
  await h.post({ type: 'export-cancelled', jobId: request.jobId });
  await h.frame.waitForFunction(() => activeJob === null);
});

test('help is hidden until hover or keyboard focus, updates by mode and dismisses with Escape', { timeout: 15000 }, async t => {
  const h = await harness(t);
  await h.frame.locator('#open-settings-btn').click();
  await h.page.mouse.move(515, 550);
  assert.equal(await h.frame.locator('.help-copy').isVisible(), false);
  assert.equal(await h.frame.locator('#tooltip').isVisible(), false);
  await h.frame.locator('#quality-row .setting-label').hover();
  await h.frame.locator('#tooltip').waitFor({ state: 'visible' });
  assert.match(await h.frame.locator('#tooltip').textContent(), /keeping text and shapes vector/);
  await h.page.keyboard.press('Escape');
  assert.equal(await h.frame.locator('#tooltip').isVisible(), false);
  await h.frame.locator('label[for="export-raster"]').click();
  await h.page.mouse.move(515, 550);
  await h.page.keyboard.press('Tab');
  await h.frame.locator('#quality-row .setting-label').focus();
  await h.frame.locator('#tooltip').waitFor({ state: 'visible' });
  assert.match(await h.frame.locator('#tooltip').textContent(), /image pages/);
  assert.equal(await h.frame.locator('#quality-row .setting-label').getAttribute('aria-describedby'), 'tooltip');
  await h.page.keyboard.press('Escape');
  assert.equal(await h.frame.locator('#tooltip').isVisible(), false);
  await h.frame.locator('#quality-more-btn').click();
  await h.page.keyboard.press('End');
  assert.equal(await h.frame.evaluate(() => document.activeElement.dataset.dpi), '300');
  await h.page.keyboard.press('Enter');
  assert.equal(await h.frame.locator('#quality-select').inputValue(), 'print-highest');
  assert.equal(await h.frame.locator('#quality-more-menu').isVisible(), false);
  await h.frame.locator('#quality-more-btn').click();
  await h.page.keyboard.press('Tab');
  assert.equal(await h.frame.locator('#quality-more-menu').isVisible(), false);
  assert.equal(await h.frame.evaluate(() => document.activeElement.textContent), 'Compression');
  await h.choose('color-profile', 'CMYK'); await h.choose('cmyk-profile-source', 'CUSTOM');
  await h.frame.locator('#cmyk-settings .setting-label').first().hover({ position: { x: 10, y: 14 } });
  await h.frame.locator('#tooltip').waitFor({ state: 'visible' });
  const customHelp = await h.frame.locator('#tooltip').textContent();
  assert.match(customHelp, /profile supplied for your printer/);
  assert.doesNotMatch(customHelp, /ISO Coated|basICColor/);
  assert.match(customHelp, /Lower resolution → Allow/);
});

test('long frame lists and conditional settings scroll while footers stay inside a compact window', { timeout: 15000 }, async t => {
  const h = await harness(t, 400, 450);
  await h.post({ type: 'frames-updated', frames: Array.from({ length: 156 }, (_, i) => ({ id: String(i), name: `Report ${i} — ${'Long frame name '.repeat(12)}`, width: 600, height: 800 })), connections: [] });
  await h.frame.waitForFunction(() => frameOrder.length === 156);
  const checkFooter = async selector => {
    const box = await h.frame.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 400 && box.y + box.height <= 450);
    assert.equal(await h.frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
  };
  await checkFooter('#open-settings-btn');
  assert.equal(await h.frame.locator('#frame-list').evaluate(element => element.scrollHeight > element.clientHeight), true);
  await h.frame.locator('#open-settings-btn').click();
  await h.choose('color-profile', 'CMYK'); await h.choose('cmyk-profile-source', 'CUSTOM'); await h.choose('output-mode', 'parts');
  await checkFooter('#export-btn');
  await h.frame.locator('#pages-per-part').fill('2');
  await checkFooter('#back-btn');
  await h.frame.locator('#cmyk-profile').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('not a profile') });
  assert.equal(await h.frame.locator('#cmyk-profile-status').isVisible(), true, 'invalid-profile feedback is not hidden in a tooltip');
  assert.match(await h.frame.locator('#cmyk-profile-status').textContent(), /non-empty.*16 MiB/);
  await checkFooter('#export-btn');
});
