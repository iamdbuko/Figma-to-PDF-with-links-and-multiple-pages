// Opt-in regression for native-PDF resource retention. No Figma account is used.
// PDF_EXPORT_TEST_UI=/tmp/fixed.html node scripts/stress-native-resources.mjs
// Optional positional cases: baseline-36-split15 fixed-original-single
// fixed-72-single fixed-36-single fixed-36-split15.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import * as P from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = path.resolve(root, argument('output') || 'docs/heavy-native-results.json');
const artifacts = path.join(root, 'test-results/heavy-native');
const fixedHtml = await fs.readFile(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8');
const scenarios = [
  { id: 'baseline-36-split15', baseline: true, dpi: '36', pagesPerPart: 15 },
  { id: 'fixed-original-single', dpi: 'original', pagesPerPart: 77 },
  { id: 'fixed-72-single', dpi: '72', pagesPerPart: 77 },
  { id: 'fixed-36-single', dpi: '36', pagesPerPart: 77 },
  { id: 'fixed-36-split15', dpi: '36', pagesPerPart: 15 }
];
const selected = process.argv.slice(2).filter(value => !value.startsWith('--'));
assert(selected.every(value => scenarios.some(scenario => scenario.id === value)), 'Unknown benchmark scenario.');
const cases = scenarios.filter(scenario => !selected.length || selected.includes(scenario.id));
const baselineHtml = cases.some(scenario => scenario.baseline)
  ? argument('baseline-ui') ? await fs.readFile(argument('baseline-ui'), 'utf8')
    : execFileSync('git', ['show', 'v9.0.0:ui.html'], { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
  : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const n = P.PDFName.of;
const frameCount = 77;
const frames = Array.from({ length: frameCount }, (_, index) => ({ id: `synthetic-${index}`, name: `Screenshot ${index % 4}`, width: 600, height: 400 }));
const rects = [[500, 30, 530, 50], [550, 30, 580, 50]];
const connections = frames.flatMap((frame, index) => [1, -1].map((delta, direction) => ({
  fromFrameId: frame.id, toFrameId: frames[(index + frameCount + delta) % frameCount].id,
  source: 'prototype', type: 'internal', elementBounds: { x: rects[direction][0], y: 350, width: 30, height: 20 }
})));

function noise(length, initial) {
  const bytes = new Uint8Array(length); let seed = initial;
  for (let index = 0; index < length; index++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; bytes[index] = seed & 255;
  }
  return bytes;
}

function records(document, page) {
  return (page.node.lookupMaybe(n('Annots'), P.PDFArray)?.asArray() || []).map(ref => {
    const annotation = document.context.lookup(ref);
    const rect = annotation.lookup(n('Rect'), P.PDFArray).asArray().map(value => value.asNumber());
    const action = annotation.lookupMaybe(n('A'), P.PDFDict);
    if (action?.get(n('S'))?.toString() === '/URI') return { kind: 'URI', uri: action.lookup(n('URI')).decodeText(), rect };
    if (action?.get(n('S'))?.toString() === '/GoToR') return { kind: 'remote', filename: action.lookup(n('F')).decodeText(), page: action.lookup(n('D'), P.PDFArray).lookup(0).asNumber(), rect };
    const destination = annotation.lookupMaybe(n('Dest'), P.PDFArray);
    assert(destination, 'every fixture annotation must have a supported destination');
    return { kind: 'local', ref: destination.get(0).toString(), rect };
  });
}

function contentHashes(document, page) {
  const contents = page.node.lookup(n('Contents'));
  return (contents instanceof P.PDFArray ? contents.asArray() : [contents]).map(value => {
    const stream = document.context.lookup(value);
    return hash(P.decodePDFRawStream(stream).decode());
  });
}

const source = await P.PDFDocument.load(await fs.readFile(path.join(root, 'tests/fixtures/native-links.pdf')));
const sourcePage = source.getPage(0), expectedUris = records(source, sourcePage);
assert.equal(expectedUris.length, 5);
assert(expectedUris.every(record => record.kind === 'URI'));
const xobjects = sourcePage.node.Resources().lookupMaybe(n('XObject'), P.PDFDict) || source.context.obj({});
sourcePage.node.Resources().set(n('XObject'), xobjects);
// The unused RGB image is exactly 9 MiB of valid samples. pdf-lib's raw stream
// preserves the bytes, so this fixture is deterministic across compressors.
const unused = source.context.register(source.context.stream(noise(2048 * 1536 * 3, 1234567), {
  Type: 'XObject', Subtype: 'Image', Width: 2048, Height: 1536, BitsPerComponent: 8, ColorSpace: 'DeviceRGB'
}));
const visible = source.context.register(source.context.flateStream(noise(256 * 192 * 3, 7654321), {
  Type: 'XObject', Subtype: 'Image', Width: 256, Height: 192, BitsPerComponent: 8, ColorSpace: 'DeviceRGB'
}));
xobjects.set(n('UnusedLargeImage'), unused); xobjects.set(n('VisibleImage'), visible);
sourcePage.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix(128, 0, 0, 96, 350, 220), P.drawObject('VisibleImage'), P.popGraphicsState());
const input = await source.save({ useObjectStreams: false });
const inputBase64 = Buffer.from(input).toString('base64');
const savedSource = await P.PDFDocument.load(input);
const expectedContents = contentHashes(savedSource, savedSource.getPage(0));
const report = {
  fixtureSchemaVersion: 'native-resources-77-linked-pages-v1', recordedAt: new Date().toISOString(),
  scope: 'Actual built UI, native-PDF import/resampling and production retained-data checker in isolated Chromium. A harness supplies 77 separate one-page exports, each using the same synthetic source PDF and scanner messages. It does not run Figma exportAsync or establish the contents of the reported user file. No production budget is changed.',
  fixture: { pages: frameCount, repeatedFrameNames: true, pageDimensions: { width: 600, height: 400 }, nativeUriRectanglesPerPage: 5, internalLinksPerPage: 2, unusedImageBytesPerNativePage: 9 * 1024 * 1024, usedImagePixels: { width: 256, height: 192 }, nativePageBytes: input.length, nativePageSha256: hash(input) },
  productionRetainedDataLimitBytes: 128 * 1024 * 1024,
  baselineSource: argument('baseline-ui') ? 'Explicit local baseline bundle' : 'v9.0.0:ui.html',
  measurementLimits: 'Retained serialized PDF objects are measured, not peak browser/Figma/process memory. Relative destinations are validated structurally; actual PDF viewer navigation and printed output are outside this benchmark.',
  scenarios: []
};
await fs.mkdir(artifacts, { recursive: true });
const persist = async () => { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();

async function inspect(download, part, plan, scenario) {
  const artifactPath = path.join(artifacts, download.suggestedFilename());
  assert.equal(download.suggestedFilename(), part.filename);
  await download.saveAs(artifactPath);
  const bytes = await fs.readFile(artifactPath), document = await P.PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), part.end - part.start);
  const expectedWidth = scenario.dpi === 'original' ? 256 : 128 * Number(scenario.dpi) / 72;
  let local = 0, remote = 0, uri = 0;
  for (const [index, page] of document.getPages().entries()) {
    assert.deepEqual(page.getSize(), { width: 600, height: 400 });
    assert.deepEqual(contentHashes(document, page), expectedContents, 'native vector/text drawing instructions remain byte-identical after decoding');
    const annotations = records(document, page);
    assert.equal(annotations.length, 7);
    const actualUris = annotations.filter(record => record.kind === 'URI');
    assert.deepEqual(actualUris, expectedUris); uri += actualUris.length;
    const expected = [1, -1].map((delta, direction) => {
      const targetIndex = (part.start + index + frameCount + delta) % frameCount;
      const targetPart = plan.find(candidate => candidate.start <= targetIndex && targetIndex < candidate.end);
      if (targetPart.index === part.index) return { kind: 'local', ref: document.getPage(targetIndex - part.start).ref.toString(), rect: rects[direction] };
      return { kind: 'remote', filename: targetPart.filename, page: targetIndex - targetPart.start, rect: rects[direction] };
    });
    const internal = annotations.filter(record => record.kind !== 'URI');
    for (const target of expected) assert.equal(internal.filter(record => JSON.stringify(record) === JSON.stringify(target)).length, 1, 'exact unique local/remote link target and rectangle');
    local += internal.filter(record => record.kind === 'local').length;
    remote += internal.filter(record => record.kind === 'remote').length;
    const objects = page.node.Resources().lookup(n('XObject'), P.PDFDict);
    assert.equal(objects.has(n('UnusedLargeImage')), false);
    const image = objects.lookup(n('VisibleImage'), P.PDFRawStream);
    assert.equal(image.dict.lookup(n('Width')).asNumber(), expectedWidth);
    assert.equal(image.dict.lookup(n('Height')).asNumber(), expectedWidth * .75);
  }
  const allImages = document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof P.PDFRawStream && object.dict.get(n('Subtype'))?.toString() === '/Image');
  assert.equal(allImages.length, document.getPageCount(), 'one visible image per page; no orphan unused image streams');
  return { index: part.index, pages: document.getPageCount(), outputBytes: bytes.length, sha256: hash(bytes), artifact: path.relative(root, artifactPath), validation: { exactPageDimensions: true, exactDecodedDrawingInstructions: true, exactUsedImageDimensions: true, noUnusedOrOrphanImages: true, exactUriRectanglesAndUrls: true, exactInternalTargetsAndRectangles: true, noDuplicateAnnotations: true, uriLinks: uri, localLinks: local, crossPartLinks: remote } };
}

async function run(scenario) {
  const began = performance.now(), html = scenario.baseline ? baselineHtml : fixedHtml;
  const result = { ...scenario, builtUiSha256: hash(html), status: 'running', requestedPages: frameCount, rasterFormat: 'JPG', fitOversized: true, exportType: 'vector', pages: [], parts: [] };
  report.scenarios.push(result); await persist();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 600, height: 1000 } });
  const page = await context.newPage(), errors = [], downloads = [], network = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('download', download => downloads.push(download));
  await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
  try {
    await page.setContent('<script>window.received=[];addEventListener("message",e=>{if(e.data?.pluginMessage)received.push(e.data.pluginMessage)})</script><iframe style="width:520px;height:650px"></iframe>');
    const frame = page.frames()[1]; await frame.setContent(html);
    await frame.evaluate(encoded => { window.nativeInput = Uint8Array.from(atob(encoded), character => character.charCodeAt(0)); }, inputBase64);
    const post = message => frame.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: { ...message, ...(message.type === 'export-page' ? { data: window.nativeInput } : {}) } } })), message);
    const waitMessage = async (types, fields = {}) => {
      await page.waitForFunction(({ types, fields }) => received.some(message => types.includes(message.type) && Object.entries(fields).every(([key, value]) => message[key] === value)), { types, fields }, { timeout: 120000 });
      return page.evaluate(({ types, fields }) => received.findLast(message => types.includes(message.type) && Object.entries(fields).every(([key, value]) => message[key] === value)), { types, fields });
    };
    await frame.evaluate(() => {
      if (PDF_DOCUMENT_LIMIT !== 128 * 1024 * 1024) throw new Error('The production budget must remain unchanged.');
      window.budgetSamples = []; window.downloadClicks = 0; window.liveUrls = new Set();
      const check = assertPdfBudget;
      assertPdfBudget = (...args) => { window.budgetSamples.push(estimatePdfBytes(args[0])); return check(...args); };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.liveUrls.add(url); return url; };
      URL.revokeObjectURL = url => { window.liveUrls.delete(url); return revoke(url); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { window.downloadClicks++; return click.call(this); };
    });
    await post({ type: 'frames-updated', frames, connections });
    await frame.locator('#open-settings-btn').click();
    await frame.locator('label[for="export-vector"]').click();
    await frame.locator('#vector-image-dpi').selectOption(scenario.dpi, { force: true });
    await frame.locator('[data-setting="raster-format"][data-value="JPG"]').click();
    await frame.locator('[data-setting="fit-oversized"][data-value="true"]').click();
    await frame.locator(`[data-setting="output-mode"][data-value="${scenario.pagesPerPart < frameCount ? 'parts' : 'single'}"]`).click();
    if (scenario.pagesPerPart < frameCount) await frame.locator('#pages-per-part').fill(String(scenario.pagesPerPart));
    await frame.locator('#export-btn').click();
    const request = await waitMessage(['export-pdf']);
    assert.deepEqual(request.selectedFrames, frames.map(frame => frame.id));
    assert.equal(request.exportType, 'vector'); assert.equal(request.rasterFormat, 'JPG'); assert.equal(request.fitOversized, true); assert.equal(request.colorProfile, 'DOCUMENT');
    assert.equal(request.qualityScale, scenario.dpi === 'original' ? 1 : Number(scenario.dpi) / 72);
    await post({ type: 'export-start', jobId: request.jobId, frames, connections, exportColorProfile: 'SRGB', outputColorMode: 'RGB' });
    await frame.waitForFunction(() => activeJob?.started);
    const plan = await frame.evaluate(() => activeJob.parts);
    for (let index = 0; index < frames.length; index++) {
      const started = performance.now(), part = plan.find(part => part.start <= index && index < part.end);
      await post({ type: 'export-page', jobId: request.jobId, index, frame: frames[index], format: 'PDF', exportColorProfile: 'SRGB', outputColorMode: 'RGB' });
      await page.waitForFunction(({ jobId, index }) => received.some(message => message.jobId === jobId && (message.type === 'export-failed' || (['page-ack', 'part-ready'].includes(message.type) && message.index === index))), { jobId: request.jobId, index }, { timeout: 120000 });
      const response = await page.evaluate(({ jobId, index }) => received.findLast(message => message.jobId === jobId && (message.type === 'export-failed' || (['page-ack', 'part-ready'].includes(message.type) && message.index === index))), { jobId: request.jobId, index });
      result.pages.push({ index, processingMs: Math.round(performance.now() - started), response: response.type });
      if (response.type === 'export-failed') {
        assert(scenario.baseline, response.message); assert.match(response.message, /128 MiB retained-data allowance/);
        assert.equal(index, 14, 'the released baseline must fail on page15 before completing its first part');
        result.failurePage = index + 1; result.guardMessage = response.message;
        assert.equal(downloads.length, 0);
        await post({ type: 'export-error', jobId: request.jobId, message: response.message });
        await frame.waitForFunction(() => activeJob === null);
        assert.deepEqual(await frame.evaluate(() => ({ downloads: window.downloadClicks, liveUrls: window.liveUrls.size })), { downloads: 0, liveUrls: 0 });
        assert.equal(await page.evaluate(() => received.some(message => message.type === 'export-finished')), false);
        result.status = 'expected-retained-budget-stop'; break;
      }
      assert.equal(response.fallback, undefined, 'valid native content must not be rasterized');
      if (response.type === 'part-ready') {
        await frame.waitForFunction(() => activeJob?.awaitingContinue, {}, { timeout: 120000 });
        assert.equal(downloads.length, part.index + 1);
        result.parts.push(await inspect(downloads[part.index], part, plan, scenario));
        assert.equal(await frame.evaluate(() => activeJob.pdf), null);
        await frame.locator('#continue-btn').click();
        await waitMessage(['page-ack'], { jobId: request.jobId, index });
      }
      if ((index + 1) % 15 === 0) console.log(`${scenario.id}: ${index + 1}/${frameCount} pages`);
    }
    if (!scenario.baseline) {
      await post({ type: 'export-complete', jobId: request.jobId });
      await waitMessage(['export-finished'], { jobId: request.jobId });
      assert.equal(downloads.length, plan.length);
      result.parts.push(await inspect(downloads.at(-1), plan.at(-1), plan, scenario));
      assert.equal(result.parts.reduce((sum, part) => sum + part.pages, 0), frameCount);
      result.status = 'passed';
    } else assert.equal(result.status, 'expected-retained-budget-stop');
    result.peakMeasuredRetainedPdfBytes = await frame.evaluate(() => Math.max(...window.budgetSamples));
    result.outputBytes = result.parts.reduce((sum, part) => sum + part.outputBytes, 0);
    result.validation = { exactLinkChecksAfterSaveReload: !scenario.baseline, zeroFallbackRequests: await page.evaluate(() => !received.some(message => message.type === 'page-ack' && message.fallback)), browserErrors: errors, networkRequests: network };
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
  } catch (error) {
    result.status = 'failed'; result.error = error.message.replaceAll(root, '<repository>'); process.exitCode = 1;
  } finally {
    result.durationMs = Math.round(performance.now() - began);
    await context.close(); await persist();
    console.log(`${scenario.id}: ${result.status} (${result.durationMs} ms)`);
  }
}

try { for (const scenario of cases) await run(scenario); }
finally { await browser.close(); await persist(); }
console.log(`Results: ${path.relative(root, output)}`);
