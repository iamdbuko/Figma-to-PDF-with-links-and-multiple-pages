// Opt-in benchmark of the built UI. Run npm run build first, then this script.
// Uses isolated headless Chromium, never the user's browser or Figma account.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, decodePDFRawStream } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8');
const reportPath = process.argv.find(value => value.startsWith('--output='))?.slice('--output='.length);
const output = path.resolve(root, reportPath || 'docs/large-file-results.json');
const artifacts = path.resolve(root, process.argv.find(value => value.startsWith('--artifacts='))?.slice('--artifacts='.length) || 'test-results/combined-large/rgb');
const hash = value => createHash('sha256').update(value).digest('hex');
const MiB = 1024 * 1024;
const productionBudget = 128 * MiB;
const fixtureSchemaVersion = 'large-raster-combined-links-v1';
// Stable LittleCMS-generated sRGB bytes in src/color-profiles.js, not just any RGB ICC.
const expectedSrgbSha256 = '81d313ce695fe3d921806c24018e87561b90127a69057797cfe20f9b508359b8';
const dimensions = { width: 3840, height: 2160 };
const pixels = { width: 5760, height: 3240 };
const requested = process.argv.slice(2).filter(value => !value.startsWith('--'));
const knownScenarios = ['png', 'jpeg', 'parts', 'parts-small-budget'];
assert(requested.every(value => knownScenarios.includes(value)), 'Scenarios: png, jpeg, parts, parts-small-budget; optional --append');
const report = {
  recordedAt: new Date().toISOString(), platform: process.platform, fixtureSchemaVersion,
  builtUiSha256: hash(html), productionRetainedDataBudgetBytes: productionBudget,
  expectedSrgbSha256,
  scope: 'Actual built plugin UI and bundled pdf-lib in isolated headless Chromium. The harness supplies synthetic raster export-page messages and performs the backend handshake. It does not run Figma exportAsync, document traversal, or the backend sandbox. Production retained-object checks run unchanged for single-file and production multipart scenarios. The optional small-budget multipart scenario changes only the default budget in the in-memory test document, explicitly recorded per scenario; it does not modify the built file or expose a production test setting.',
  memoryScope: 'CDP Runtime.getHeapUsage sampled after page acknowledgements, before/after part downloads, and after final download. V8 usedSize and backingStorageSize are separate values, not whole-browser, native decoder, GPU, Figma, or peak resident memory. Samples can miss transient peaks. The renderer also contains the deterministic fixture canvas and one encoded input; no forced garbage collection is used. Node-side PDF validation is outside these renderer samples.',
  rasterSource: 'The same deterministic full-resolution gradients, twelve curved terrain layers, and smoothly enlarged 192x108 seeded noise field as the earlier detailed PNG benchmark. Every page differs. Both encodings start from identical canvas pixels, checked by a full-pixel FNV-1a fingerprint for corresponding pages. This is a synthetic compressible landscape, not a photo corpus or worst-case entropy workload.',
  jpegEncoding: 'Browser canvas.toBlob(image/jpeg, 0.9), at the same 5760x3240 pixels as PNG. Lossy compression; no claim that this matches Figma native JPG quality or file sizes. The PDF must retain the exact supplied JPEG bytes as a DCT stream.',
  historicalBaseline: 'docs/stress-results.json remains the historical result: the prior cumulative 128 MiB input rule stopped the detailed PNG workload after 10 pages. This benchmark does not enforce that obsolete input-total rule.',
  linkScope: 'Every page combines eight expected annotations: one external prototype URL, two wrapped external text rectangles, three forward/back/jump prototype destinations, and two exact native text NODE destinations. Small synthetic annotation PDFs model Figma URI annotations; they are not Figma-generated geometry. Duplicate scanner inputs must not create duplicates. Exact URLs, rectangles, local page refs and cross-part filenames/page indexes are checked after reloading every saved PDF. Remote destinations are structurally validated; PDF viewer navigation/security behavior is outside this test.',
  scenarios: []
};

function assertCompatibleReport(previous) {
  const message = 'Cannot append an incompatible fixture report. Use a new --output path for this combined-link benchmark.';
  assert.equal(previous?.fixtureSchemaVersion, fixtureSchemaVersion, message);
  assert(Array.isArray(previous.scenarios), message);
  assert(previous.scenarios.every(scenario => scenario?.fixtureSchemaVersion === fixtureSchemaVersion), message);
}

if (process.argv.includes('--append')) {
  const previous = JSON.parse(await fs.readFile(output, 'utf8'));
  assertCompatibleReport(previous);
  report.scenarios = previous.scenarios;
  report.previousRecordedAt = previous.recordedAt;
  report.supplementalSrgbVerification = previous.supplementalSrgbVerification;
}
// Reject incompatible reports before launching Chromium or changing an output file.
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};

// Deliberately shared by every format. No lower-complexity texture control here.
async function generateRaster({ index, format }) {
  const width = 5760, height = 3240;
  const canvas = window.stressCanvas ||= document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  const hue = (190 + index * 7) % 360;
  const sky = context.createLinearGradient(0, 0, width * .35, height);
  sky.addColorStop(0, `hsl(${hue} 42% 43%)`);
  sky.addColorStop(.56, `hsl(${(hue + 25) % 360} 38% 77%)`);
  sky.addColorStop(1, `hsl(${(hue + 55) % 360} 30% 35%)`);
  context.fillStyle = sky; context.fillRect(0, 0, width, height);
  for (let layer = 0; layer < 12; layer++) {
    context.beginPath(); context.moveTo(0, height);
    for (let x = 0; x <= width; x += 60) {
      const y = height * (.34 + layer * .047) + Math.sin(x / (410 + layer * 35) + index * .3 + layer) * (120 + layer * 5) + Math.cos(x / 950 + index * .13) * 110;
      context.lineTo(x, y);
    }
    context.lineTo(width, height); context.closePath();
    const gradient = context.createLinearGradient(0, height * .3, width, height);
    gradient.addColorStop(0, `hsl(${(hue + 85 + layer * 5) % 360} ${18 + layer}% ${48 - layer * 2}%)`);
    gradient.addColorStop(1, `hsl(${(hue + 125 + layer * 3) % 360} 27% ${36 - layer}%)`);
    context.fillStyle = gradient; context.fill();
  }
  const noise = window.stressNoise ||= document.createElement('canvas');
  noise.width = 192; noise.height = 108;
  const nc = noise.getContext('2d');
  const noisePixels = nc.createImageData(noise.width, noise.height);
  let seed = (index + 1) * 1234567;
  for (let p = 0; p < noisePixels.data.length; p += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 110 + (seed >>> 27);
    noisePixels.data[p] = noisePixels.data[p + 1] = noisePixels.data[p + 2] = value;
    noisePixels.data[p + 3] = 255;
  }
  nc.putImageData(noisePixels, 0, 0);
  context.globalCompositeOperation = 'soft-light'; context.globalAlpha = .35;
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(noise, 0, 0, width, height);
  context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
  // Fingerprint every source pixel before the encoder applies any loss.
  let pixelData = context.getImageData(0, 0, width, height);
  let words = new Uint32Array(pixelData.data.buffer);
  let fingerprint = 2166136261;
  for (let i = 0; i < words.length; i++) fingerprint = Math.imul(fingerprint ^ words[i], 16777619) >>> 0;
  words = null; pixelData = null;
  const mime = format === 'JPG' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, format === 'JPG' ? .9 : undefined));
  if (!blob || blob.type !== mime) throw new Error(`${format} encoding failed`);
  window.nextStressRaster = new Uint8Array(await blob.arrayBuffer());
  // The encoded fingerprint is used to prove JPEG passthrough in the PDF.
  let encoded = 2166136261;
  for (const byte of window.nextStressRaster) encoded = Math.imul(encoded ^ byte, 16777619) >>> 0;
  return { inputBytes: window.nextStressRaster.length, sourcePixelFingerprint: fingerprint.toString(16).padStart(8, '0'), encodedFingerprint: encoded.toString(16).padStart(8, '0') };
}

function fingerprintBytes(bytes) {
  let result = 2166136261;
  for (const byte of bytes) result = Math.imul(result ^ byte, 16777619) >>> 0;
  return result.toString(16).padStart(8, '0');
}

function jpegIccBytes(bytes) {
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
  const chunks = new Map(); let count = null;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    assert.equal(bytes[offset], 0xff);
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    assert(length >= 2 && offset + 2 + length <= bytes.length);
    const body = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe2 && Buffer.from(body.subarray(0, 12)).toString('ascii') === 'ICC_PROFILE\0') {
      const sequence = body[12], total = body[13];
      assert(sequence > 0 && sequence <= total && !chunks.has(sequence));
      if (count !== null) assert.equal(total, count);
      count = total; chunks.set(sequence, body.subarray(14));
    }
    offset += length + 2;
  }
  assert(count && chunks.size === count, 'Chromium JPEG fixture must include its complete original ICC');
  return Buffer.concat(Array.from({ length: count }, (_, index) => Buffer.from(chunks.get(index + 1))));
}

function pageLinkFixture(index, frames) {
  const count = frames.length, fromFrameId = frames[index].id;
  const bounds = (x, y, width, height) => ({ x, y, width, height });
  const expected = [], connections = [], nativeRecords = [];
  const add = (role, source, box, destination, textNodeId) => {
    const rect = [box.x, dimensions.height - box.y - box.height, box.x + box.width, dimensions.height - box.y];
    const external = typeof destination === 'string';
    const link = { source, type: external ? 'external' : 'internal', fromFrameId, elementBounds: box,
      ...(external ? { toUrl: destination } : { toFrameId: frames[destination].id, toNodeId: `101:${destination + 1}` }) };
    if (textNodeId) Object.assign(link, { textNodeId, needsTextGeometry: true });
    connections.push(link);
    expected.push({ role, source, rect, ...(external ? { url: destination } : { targetIndex: destination }) });
    if (source === 'text') nativeRecords.push({ rect, uri: external ? destination : `https://www.figma.com/design/combinedStress/Repeated-pages?node-id=101-${destination + 1}` });
    return link;
  };
  const external = add('external-prototype', 'prototype', bounds(10, 10, 200, 24), `https://example.com/page/${index + 1}?from=stress&mode=a%2Fb#details`);
  const wrappedUrl = `https://example.org/guide/${index + 1}?q=print%20proof&ref=combined#wrapped`;
  const wrappedBox = bounds(10, 58, 220, 48);
  for (const [y, width] of [[60.25, 180.5], [82.25, 120.5]]) {
    const link = add('external-wrapped-text', 'text', bounds(10.25, y, width, 18.5), wrappedUrl, `wrapped-${index}`);
    link.elementBounds = wrappedBox;
  }
  const forward = (index + 1) % count, backward = (index + count - 1) % count;
  const next = add('forward', 'prototype', bounds(10, 140, 100, 30), forward);
  add('backward', 'prototype', bounds(140, 140, 100, 30), backward);
  add('jump', 'prototype', bounds(270, 140, 100, 30), (index + Math.floor(count / 2)) % count);
  for (const [role, target, x] of [['forward', forward, 10.25], ['backward', backward, 140.25]]) {
    const link = add(role, 'text', bounds(x, 200.25, 90.5, 18.5), target, `internal-shared-${index}`);
    link.elementBounds = bounds(10, 190, 260, 44);
  }
  // Repeated scanner records must not create overlapping duplicate annotations.
  connections.push({ ...external }, { ...next });
  return { expected, connections, nativeRecords };
}

async function annotationPdf(records) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([dimensions.width, dimensions.height]);
  const refs = records.map(({ rect, uri }) => pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of(uri) }
  })));
  page.node.set(PDFName.of('Annots'), pdf.context.obj(refs));
  return pdf.save();
}

function annotations(document, page) {
  const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!list) return [];
  return list.asArray().map(ref => document.context.lookup(ref, PDFDict)).map(item => {
      assert.equal(item.get(PDFName.of('Subtype'))?.toString(), '/Link');
      const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
      const dest = item.lookupMaybe(PDFName.of('Dest'), PDFArray);
      const remoteDest = action?.lookupMaybe(PDFName.of('D'), PDFArray);
      return {
        rect: item.lookup(PDFName.of('Rect'), PDFArray).asArray().map(number => number.asNumber()),
        destination: dest?.get(0)?.toString(), destinationFit: dest?.get(1)?.toString(), remoteType: action?.get(PDFName.of('S'))?.toString(),
        url: action?.get(PDFName.of('URI'))?.decodeText(),
        remoteFile: action?.get(PDFName.of('F'))?.decodeText(), remotePage: remoteDest?.get(0)?.asNumber(), remoteFit: remoteDest?.get(1)?.toString()
      };
    });
}

function validatePageLinks(document, page, index, part, plan, frames) {
  const actual = annotations(document, page), expected = pageLinkFixture(index, frames).expected;
  assert.equal(actual.length, expected.length, `page ${index + 1}: no missing or extra link annotations`);
  assert.equal(new Set(actual.map(item => JSON.stringify(item))).size, actual.length, 'no duplicate annotations');
  const counts = { externalLinks: 0, wrappedTextLinkRectangles: 0, internalTextLinks: 0, localLinks: 0, remoteLinks: 0,
    forwardLinks: 0, backwardLinks: 0, jumpLinks: 0, remoteForwardLinks: 0, remoteBackwardLinks: 0, remoteJumpLinks: 0 };
  for (const wanted of expected) {
    const matches = actual.filter(item => JSON.stringify(item.rect) === JSON.stringify(wanted.rect));
    assert.equal(matches.length, 1, `page ${index + 1}: exact unique ${wanted.role} rectangle`);
    const link = matches[0];
    if (wanted.url) {
      assert.equal(link.remoteType, '/URI'); assert.equal(link.url, wanted.url);
      assert.equal(link.destination, undefined); assert.equal(link.remoteFile, undefined);
      counts.externalLinks++;
      if (wanted.source === 'text') counts.wrappedTextLinkRectangles++;
      continue;
    }
    assert.equal(link.url, undefined, 'internal NODE URI must be replaced, not retained');
    if (wanted.source === 'text') counts.internalTextLinks++;
    counts[`${wanted.role}Links`]++;
    const targetPart = plan.find(item => wanted.targetIndex >= item.start && wanted.targetIndex < item.end);
    if (targetPart.index === part.index) {
      assert.equal(link.destination, document.getPage(wanted.targetIndex - part.start).ref.toString());
      assert.equal(link.destinationFit, '/Fit'); assert.equal(link.remoteType, undefined);
      counts.localLinks++;
    } else {
      assert.equal(link.remoteType, '/GoToR'); assert.equal(link.remoteFile, targetPart.filename);
      assert.equal(link.remotePage, wanted.targetIndex - targetPart.start); assert.equal(link.remoteFit, '/Fit');
      assert.equal(link.destination, undefined);
      counts.remoteLinks++; counts[`remote${wanted.role[0].toUpperCase()}${wanted.role.slice(1)}Links`]++;
    }
  }
  return counts;
}

async function inspectPart(download, part, plan, scenario) {
  const bytes = await fs.readFile(await download.path());
  assert.equal(download.suggestedFilename(), part.filename);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), part.end - part.start);
  let jpegStreams = 0;
  const linkCounts = {};
  const colorProfileRefs = new Set();
  const colorProfileHashes = new Set();
  for (let localIndex = 0; localIndex < document.getPageCount(); localIndex++) {
    const index = part.start + localIndex, page = document.getPage(localIndex);
    assert.deepEqual(page.getSize(), dimensions);
    const xobjects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const images = xobjects.values().map(ref => document.context.lookup(ref)).filter(object => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
    assert.equal(images.length, 1, 'each page contains precisely one image');
    const image = images[0];
    const colorSpace = image.dict.lookup(PDFName.of('ColorSpace'), PDFArray);
    assert.equal(colorSpace.get(0).toString(), '/ICCBased', 'raster color profiles survive the large export');
    colorProfileRefs.add(colorSpace.get(1).toString());
    const profile = document.context.lookup(colorSpace.get(1));
    assert.equal(profile.dict.lookup(PDFName.of('N')).asNumber(), 3);
    const profileBytes = Buffer.from(decodePDFRawStream(profile).decode());
    colorProfileHashes.add(hash(profileBytes));
    if (scenario.format === 'JPG') assert.deepEqual(profileBytes, jpegIccBytes(image.contents), 'the original JPEG ICC survives without relabeling');
    else assert.equal(hash(profileBytes), expectedSrgbSha256, 'the exact canonical sRGB profile tags the unprofiled PNG');
    assert.equal(image.dict.lookup(PDFName.of('Width')).asNumber(), pixels.width);
    assert.equal(image.dict.lookup(PDFName.of('Height')).asNumber(), pixels.height);
    if (scenario.format === 'JPG') {
      assert.equal(image.dict.get(PDFName.of('Filter')).toString(), '/DCTDecode');
      assert.equal(image.contents.length, scenario.pages[index].inputBytes);
      assert.equal(fingerprintBytes(image.contents), scenario.pages[index].encodedFingerprint);
      jpegStreams++;
    } else assert.equal(image.dict.get(PDFName.of('Filter')).toString(), '/FlateDecode');
    for (const [key, value] of Object.entries(validatePageLinks(document, page, index, part, plan, scenario.frames))) linkCounts[key] = (linkCounts[key] || 0) + value;
  }
  assert.equal(colorProfileRefs.size, 1, 'the shared sRGB profile is embedded once per document');
  const artifactPath = path.join(artifacts, `${scenario.format.toLowerCase()}-${scenario.pagesPerPart}-pages-per-part`, part.filename);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, bytes);
  return { index: part.index, filename: part.filename, artifact: path.relative(root, artifactPath), startPage: part.start, endPageExclusive: part.end, outputBytes: bytes.length, sha256: hash(bytes), validation: { pages: document.getPageCount(), exactPageDimensions: true, exactRasterDimensions: true, ...linkCounts, exactLinkRectangles: true, exactUrlsAndDestinations: true, noDuplicateAnnotations: true, originalJpegStreams: jpegStreams, sharedRgbProfiles: colorProfileRefs.size, exactRgbProfileBytes: true, rgbProfileSha256s: [...colorProfileHashes] } };
}

async function runScenario({ name, format, pagesPerPart = 30, testBudget = null }) {
  const count = 30;
  const context = await browser.newContext({ acceptDownloads: true });
  const result = { name, format, fixtureSchemaVersion, requestedPages: count, pagesPerPart, builtUiSha256: hash(html), retainedDataBudgetBytes: testBudget || productionBudget, testOnlyBudgetOverride: testBudget !== null, pageDimensions: dimensions, rasterDimensions: { ...pixels, scale: 1.5 }, status: 'running', pages: [], parts: [], compressedInputBytes: 0, budgetSamples: [], memorySamples: [] };
  report.scenarios.push(result);
  const began = performance.now();
  try {
    const page = await context.newPage(), errors = [], downloads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', download => downloads.push(download));
    await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe title="Plugin UI" style="width:440px;height:900px"></iframe>');
    const frame = page.frames()[1];
    await frame.setContent(html);
    await frame.waitForFunction(() => typeof assertPdfBudget === 'function' && typeof createOutputPlan === 'function', null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    // In-memory instrumentation only; every measurement still calls the production checker.
    await frame.evaluate(testBudget => {
      window.stressBudgetSamples = [];
      const original = assertPdfBudget;
      assertPdfBudget = function (pdf, limit) {
        const bytes = estimatePdfBytes(pdf);
        window.stressBudgetSamples.push({ bytes, pages: pdf.getPageCount(), partIndex: activeJob?.partIndex });
        return original(pdf, limit ?? testBudget ?? PDF_DOCUMENT_LIMIT);
      };
      window.stressLiveUrls = new Set();
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.stressLiveUrls.add(url); return url; };
      URL.revokeObjectURL = url => { window.stressLiveUrls.delete(url); revoke(url); };
      window.stressDownloadStarts = 0;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (...args) {
        if (this.download) window.stressDownloadStarts++;
        return click.apply(this, args);
      };
    }, testBudget);
    const cdp = await context.newCDPSession(page);
    const sample = async label => result.memorySamples.push({ label, ...await cdp.send('Runtime.getHeapUsage') });
    const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
    const waitMessage = async (types, fields = {}, timeout = 120000) => {
      types = Array.isArray(types) ? types : [types];
      await page.waitForFunction(({ types, fields }) => received.some(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (key === 'index' && message.type === 'export-failed'))), { types, fields }, { timeout });
      const message = await page.evaluate(({ types, fields }) => received.findLast(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (key === 'index' && message.type === 'export-failed'))), { types, fields });
      return message;
    };
    const frames = Array.from({ length: count }, (_, index) => ({ id: `large-raster-${index}`, name: `Repeated name ${index % 3}`, parent: 'Stress fixture', ...dimensions }));
    result.frames = frames;
    const fixtures = frames.map((_, index) => pageLinkFixture(index, frames));
    const connections = fixtures.flatMap(item => item.connections);
    await post({ type: 'frames-updated', frames, connections, justAdded: frames.map(item => item.id) });
    await frame.locator('#open-settings-btn').click();
    await frame.locator('#settings-screen').waitFor({ state: 'visible' });
    await frame.locator('label[for="export-raster"]').click();
    assert.equal(await frame.locator('#export-raster').isChecked(), true);
    await frame.locator('[data-setting="color-profile"][data-value="SRGB"]').click();
    await frame.locator('[data-dpi="108"]').click();
    await frame.locator(`[data-setting="raster-format"][data-value="${format}"]`).click();
    await frame.locator(`[data-setting="output-mode"][data-value="${pagesPerPart < count ? 'parts' : 'single'}"]`).click();
    if (pagesPerPart < count) await frame.locator('#pages-per-part').fill(String(pagesPerPart));
    await frame.locator('#export-btn').click();
    const request = await waitMessage('export-pdf');
    assert.deepEqual(request.selectedFrames, frames.map(item => item.id));
    assert.equal(request.exportType, 'raster');
    assert.equal(request.rasterFormat, format);
    assert.equal(request.qualityScale, 1.5);
    assert.equal(request.colorProfile, 'SRGB');
    result.exportRequest = { exportType: request.exportType, rasterFormat: request.rasterFormat, qualityScale: request.qualityScale, colorProfile: request.colorProfile };
    const jobId = request.jobId;
    await post({ type: 'export-start', jobId, frames, connections, exportColorProfile: 'SRGB', outputColorMode: 'RGB' });
    await frame.waitForFunction(() => activeJob?.started);
    const plan = await frame.evaluate(() => activeJob.parts);
    assert.equal(plan.length, Math.ceil(count / pagesPerPart));
    await sample('before-pages');
    for (let index = 0; index < count; index++) {
      const generationStart = performance.now();
      const source = await page.evaluate(generateRaster, { index, format });
      const generationMs = Math.round(performance.now() - generationStart);
      result.compressedInputBytes += source.inputBytes;
      const annotationPdfData = await annotationPdf(fixtures[index].nativeRecords);
      result.auxiliaryAnnotationBytes = (result.auxiliaryAnnotationBytes || 0) + annotationPdfData.length;
      const assemblyStart = performance.now();
      await page.evaluate(({ jobId, index, frame, format, annotationPdfData }) => {
        document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: { type: 'export-page', jobId, index, frame, format, data: window.nextStressRaster, annotationPdfData: new Uint8Array(annotationPdfData), exportColorProfile: 'SRGB', outputColorMode: 'RGB' } }, '*');
        window.nextStressRaster = null;
      }, { jobId, index, frame: frames[index], format, annotationPdfData: Array.from(annotationPdfData) });
      const message = await waitMessage(['page-ack', 'part-ready'], { jobId, index });
      result.pages.push({ index, ...source, generationMs, assemblyMs: Math.round(performance.now() - assemblyStart), acknowledged: message.type !== 'export-failed' });
      await sample(`page-${index + 1}-${message.type}`);
      if (message.type === 'export-failed') {
        if (format !== 'PNG' || pagesPerPart < count || !/retained-data allowance/.test(message.message)) throw new Error(message.message);
        result.status = 'retained-budget-stop'; result.guardMessage = message.message;
        assert.equal(downloads.length, 0, 'over-budget single file must not download a partial document');
        await post({ type: 'export-error', jobId, message: message.message });
        await frame.waitForFunction(() => activeJob === null);
        assert.equal(downloads.length, 0, 'terminal cleanup must not download an incomplete document');
        const finished = await page.evaluate(jobId => received.some(message => message.type === 'export-finished' && message.jobId === jobId), jobId);
        assert.equal(finished, false);
        const cleanup = await frame.evaluate(() => ({ activeJobReleased: activeJob === null, liveBlobUrls: window.stressLiveUrls.size, anchorDownloadStarts: window.stressDownloadStarts }));
        assert.deepEqual(cleanup, { activeJobReleased: true, liveBlobUrls: 0, anchorDownloadStarts: 0 });
        result.refusalCleanup = { ...cleanup, downloads: downloads.length, exportFinished: finished };
        break;
      }
      assert.equal(message.fallback, undefined);
      if (message.type === 'part-ready') {
        const part = plan.find(item => item.end === index + 1);
        assert(part && part.index < plan.length - 1);
        await frame.waitForFunction(() => !document.getElementById('continue-btn').hidden);
        const download = downloads[part.index] || await page.waitForEvent('download');
        await download.path();
        const appendFinalizeAndDownloadMs = Math.round(performance.now() - assemblyStart);
        const retained = await frame.evaluate(() => ({ pdfReleased: activeJob.pdf === null, pageObjects: activeJob.pages.length, liveUrls: window.stressLiveUrls.size, nextIndex: activeJob.nextIndex }));
        assert.equal(retained.pdfReleased, true);
        assert.equal(retained.pageObjects, 0);
        assert.equal(retained.liveUrls, 1, 'only the current part download may retain a Blob URL');
        assert.equal(await page.evaluate(({ jobId, index }) => received.some(item => item.type === 'page-ack' && item.jobId === jobId && item.index === index), { jobId, index }), false, 'no next-page ACK before explicit Continue');
        const checked = await inspectPart(download, part, plan, result);
        result.parts.push({ ...checked, appendFinalizeAndDownloadMs, pausedState: retained });
        assert.deepEqual(await frame.evaluate(() => activeJob.warnings), []);
        await frame.locator('#continue-btn').click();
        const ack = await waitMessage('page-ack', { jobId, index });
        assert.equal(ack.type, 'page-ack');
        assert.equal(await frame.evaluate(() => window.stressLiveUrls.size), 0, 'Continue releases the saved part URL');
        await sample(`part-${part.index + 1}-released`);
      }
      if ((index + 1) % 5 === 0) console.log(`${name}: ${index + 1}/${count}; ${(result.compressedInputBytes / MiB).toFixed(1)} MiB input`);
    }
    if (result.status === 'running') {
      const saveStart = performance.now();
      await post({ type: 'export-complete', jobId });
      const finished = await waitMessage('export-finished', { jobId });
      if (finished.type === 'export-failed') throw new Error(finished.message);
      const finalPart = plan.at(-1);
      const download = downloads[finalPart.index] || await page.waitForEvent('download');
      result.finalizeAndDownloadMs = Math.round(performance.now() - saveStart);
      await sample('after-final-download');
      result.parts.push(await inspectPart(download, finalPart, plan, result));
      assert.equal(downloads.length, plan.length);
      assert.equal(result.parts.reduce((sum, part) => sum + part.validation.pages, 0), count);
      result.outputBytes = result.parts.reduce((sum, part) => sum + part.outputBytes, 0);
      const linkCounts = {};
      for (const part of result.parts) for (const [key, value] of Object.entries(part.validation)) if (key.endsWith('Links') || key === 'wrappedTextLinkRectangles') linkCounts[key] = (linkCounts[key] || 0) + value;
      assert.equal(linkCounts.externalLinks, count * 3);
      assert.equal(linkCounts.localLinks + linkCounts.remoteLinks, count * 5);
      if (plan.length > 1) for (const key of ['remoteForwardLinks', 'remoteBackwardLinks', 'remoteJumpLinks']) assert(linkCounts[key] > 0, `${key} exercised`);
      result.validation = { outputPages: count, exactPageDimensions: true, exactRasterPixelDimensions: true, ...linkCounts, exactLinkRectangles: true, exactUrlsAndDestinations: true, noDuplicateAnnotations: true, originalJpegStreams: result.parts.reduce((sum, part) => sum + part.validation.originalJpegStreams, 0), repeatedNamesResolvedByFrameId: true, automaticContinue: false, browserErrors: errors };
      if (testBudget) assert(result.outputBytes > testBudget, 'multipart workload must exceed the per-document test budget in total');
      result.status = 'passed';
    }
    result.budgetSamples = await frame.evaluate(() => window.stressBudgetSamples);
    assert(result.budgetSamples.length > 0, 'the production retained-object checker must run');
    if (result.status === 'passed') assert(result.budgetSamples.every(item => item.bytes <= result.retainedDataBudgetBytes));
    if (format === 'PNG' && pagesPerPart === count) assert.equal(result.status, 'retained-budget-stop', 'the detailed single-PDF PNG workload must trigger the production retained-data guard');
    assert.deepEqual(errors, []);
  } catch (error) {
    result.status = 'failed'; result.error = error.stack || String(error); process.exitCode = 1;
  } finally {
    result.durationMs = Math.round(performance.now() - began);
    result.acknowledgedPages = result.pages.filter(item => item.acknowledged).length;
    result.acknowledgedCompressedInputBytes = result.pages.filter(item => item.acknowledged).reduce((sum, item) => sum + item.inputBytes, 0);
    result.generationMs = result.pages.reduce((sum, item) => sum + item.generationMs, 0);
    result.pageAssemblyMs = result.pages.reduce((sum, item) => sum + item.assemblyMs, 0);
    result.peakMeasuredRetainedPdfBytes = Math.max(0, ...result.budgetSamples.map(item => item.bytes));
    result.peakSampledJsHeapBytes = Math.max(0, ...result.memorySamples.map(item => item.usedSize));
    result.peakSampledBackingStorageBytes = Math.max(0, ...result.memorySamples.map(item => item.backingStorageSize || 0));
    result.inputExceededHistorical128MiBLimit = result.compressedInputBytes > productionBudget;
    console.log(`${name}: ${result.status}, ${result.acknowledgedPages} acknowledged, ${result.durationMs} ms`);
    await persist();
    await context.close();
  }
}

try {
  if (!requested.length || requested.includes('jpeg')) await runScenario({ name: '30 identical-content 5760x3240 JPEG pages, one PDF', format: 'JPG' });
  if (!requested.length || requested.includes('parts')) await runScenario({ name: '30 detailed PNG pages, ten pages per part, production 128 MiB budget', format: 'PNG', pagesPerPart: 10 });
  if (!requested.length || requested.includes('png')) await runScenario({ name: '30 detailed 5760x3240 PNG pages, one PDF', format: 'PNG' });
  if (requested.includes('parts-small-budget')) await runScenario({ name: '30 detailed PNG pages, two pages per part, 32 MiB test budget', format: 'PNG', pagesPerPart: 2, testBudget: 32 * MiB });
  const png = report.scenarios.findLast(item => item.format === 'PNG' && item.pagesPerPart === 30);
  const jpeg = report.scenarios.findLast(item => item.format === 'JPG' && item.pagesPerPart === 30);
  if (png && jpeg && png.builtUiSha256 === jpeg.builtUiSha256) {
    const pngParts = report.scenarios.findLast(item => item.format === 'PNG' && item.pagesPerPart < 30 && item.status === 'passed' && item.builtUiSha256 === jpeg.builtUiSha256);
    const reference = pngParts?.pages.length > png.pages.length ? pngParts : png;
    const pairs = Math.min(reference.pages.length, jpeg.pages.length);
    for (let index = 0; index < pairs; index++) assert.equal(reference.pages[index].sourcePixelFingerprint, jpeg.pages[index].sourcePixelFingerprint, `source pixels match for page ${index + 1}`);
    for (let index = 0; index < png.pages.length; index++) assert.equal(png.pages[index].sourcePixelFingerprint, reference.pages[index].sourcePixelFingerprint, `single/multipart PNG source pixels match for page ${index + 1}`);
    report.comparison = { pairedSourcePages: pairs, identicalSourcePixelFingerprints: true, pairedPngInputBytes: reference.pages.slice(0, pairs).reduce((sum, item) => sum + item.inputBytes, 0), pairedJpegInputBytes: jpeg.pages.slice(0, pairs).reduce((sum, item) => sum + item.inputBytes, 0), completePngOutputBytes: png.outputBytes ?? null, completePngPartsOutputBytes: pngParts?.outputBytes ?? null, completeJpegOutputBytes: jpeg.outputBytes ?? null };
  }
} finally {
  await browser.close();
  await persist();
}
console.log(`Results: ${output}`);
