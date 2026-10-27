// Opt-in, isolated browser benchmark; never operates Figma or the user's browser.
// PDF_EXPORT_TEST_UI can point to a temporary build to avoid reloading Figma.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8');
const bundled = process.argv.includes('--bundled');
const profileFile = bundled ? 'assets/color-profiles/ISOcoated_v2_300_bas.ICC' : 'tests/fixtures/color-profiles/synthetic-cmyk-test-only.icc';
const profile = await fs.readFile(path.join(root, profileFile));
const output = path.resolve(root, process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'docs/cmyk-stress-results.json');
const artifacts = path.join(root, 'test-results/combined-large/cmyk', bundled ? 'bundled' : 'custom');
const hash = value => createHash('sha256').update(value).digest('hex');
const count = 8, pagesPerPart = 2;
const dimensions = { width: 1400, height: 1400 }, pixels = { width: 2800, height: 2800 };
const report = {
  recordedAt: new Date().toISOString(), builtUiSha256: hash(html), platform: process.platform,
  profile: { file: profileFile, source: bundled ? 'BUNDLED' : 'CUSTOM', bytes: profile.length, sha256: hash(profile), purpose: bundled ? 'Built-in basICColor ISO Coated v2 300%, FOGRA39 coated printing. No physical print validation.' : 'Synthetic LittleCMS test-only profile; not a production press profile, print recommendation, or proof.' },
  scope: 'Actual built plugin UI, bundled pdf-lib, and offline LittleCMS WASM in isolated headless Chromium. The harness uses the indicated profile source, sends one PNG page at a time, honors part-ready/page-ack, and clicks Continue only after validating each downloaded part. Representative PDFs are saved only under ignored test-results/combined-large/. No Figma exportAsync, backend sandbox, document traversal, print device, or physical color proof is included.',
  linkScope: 'Every page combines eight expected annotations: one external prototype URL, two wrapped external text rectangles, three forward/back/jump prototype destinations, and two exact native text NODE destinations. Small synthetic annotation PDFs model Figma URI annotations; they are not Figma-generated geometry. Duplicate scanner inputs must not create duplicates. Exact URLs, rectangles, local page refs and cross-part filenames/page indexes are checked after reloading every saved PDF. Remote destinations are structurally validated; PDF viewer navigation/security behavior is outside this test.',
  memoryScope: 'CDP Runtime.getHeapUsage samples V8 usedSize and backingStorageSize separately. Samples are not total browser/Figma/native decoder/GPU resident memory and can miss transient peaks. The renderer includes a reusable fixture canvas and one encoded PNG. No forced garbage collection is used. Node-side PDF inspection is outside renderer samples. WASM heap length is reported separately and must not be added to backingStorageSize as if disjoint.',
  rasterSource: 'Eight distinct 2800x2800 synthetic landscapes: layered gradients and curved terrain plus smoothly enlarged seeded low-resolution noise. Small transparent and translucent regions exercise white compositing. These are compressible photo-like fixtures, not a real photograph corpus or worst-case random entropy workload. Pages are generated sequentially, only after the prior page/part is acknowledged.',
  requestedPages: count, pagesPerPart, pageDimensions: dimensions, rasterDimensions: pixels,
  pixelsPerPage: pixels.width * pixels.height, cmykPixelLimit: 8000000,
  retainedDataBudgetBytes: 128 * 1024 * 1024, status: 'running', pages: [], parts: [],
  compressedInputBytes: 0, memorySamples: [], retainedBudgetSamples: [],
};
const browser = await chromium.launch({ headless: true });
report.browser = browser.version();
const context = await browser.newContext({ acceptDownloads: true });
const began = performance.now();

async function generateRaster(index) {
  const width = 2800, height = 2800;
  const canvas = window.cmykStressCanvas ||= document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const hue = (178 + index * 11) % 360;
  const sky = ctx.createLinearGradient(0, 0, width * .8, height);
  sky.addColorStop(0, `hsl(${hue} 43% 37%)`);
  sky.addColorStop(.55, `hsl(${hue + 20} 32% 78%)`);
  sky.addColorStop(1, `hsl(${hue + 50} 38% 31%)`);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  for (let layer = 0; layer < 12; layer++) {
    ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 30) ctx.lineTo(x, height * (.3 + layer * .05) + Math.sin(x / (240 + layer * 32) + index * .4 + layer) * (90 + layer * 6));
    ctx.lineTo(width, height); ctx.closePath();
    const gradient = ctx.createLinearGradient(0, height * .3, width, height);
    gradient.addColorStop(0, `hsl(${hue + 85 + layer * 5} ${18 + layer}% ${49 - layer * 2}%)`);
    gradient.addColorStop(1, `hsl(${hue + 120 + layer * 3} 29% ${37 - layer}%)`);
    ctx.fillStyle = gradient; ctx.fill();
  }
  const noise = window.cmykNoiseCanvas ||= document.createElement('canvas');
  noise.width = 160; noise.height = 160;
  const nc = noise.getContext('2d'), data = nc.createImageData(160, 160);
  let seed = (index + 1) * 1234567;
  for (let p = 0; p < data.data.length; p += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 96 + (seed >>> 26);
    data.data[p] = data.data[p + 1] = data.data[p + 2] = value; data.data[p + 3] = 255;
  }
  nc.putImageData(data, 0, 0);
  ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .45;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(noise, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.clearRect(0, height - 120, 240, 120);
  ctx.fillStyle = 'rgba(225,50,70,0.4)'; ctx.fillRect(120, height - 120, 120, 120);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png') throw new Error('PNG fixture encoding failed');
  window.nextCmykPng = new Uint8Array(await blob.arrayBuffer());
  return { inputBytes: window.nextCmykPng.length };
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

async function inspectPart(download, part, plan, frames) {
  const bytes = await fs.readFile(await download.path());
  assert.equal(download.suggestedFilename(), part.filename);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), pagesPerPart);
  const profileRefs = new Set();
  let fourChannelPixels = 0;
  const linkCounts = {};
  for (let local = 0; local < pdf.getPageCount(); local++) {
    const index = part.start + local, page = pdf.getPage(local);
    assert.deepEqual(page.getSize(), dimensions);
    const objects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const images = objects.values().map(ref => pdf.context.lookup(ref)).filter(object => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    assert.equal(images.length, 1);
    const image = images[0], colorSpace = image.dict.lookup(PDFName.of('ColorSpace'), PDFArray);
    assert.equal(colorSpace.get(0).toString(), '/ICCBased');
    assert.equal(image.dict.lookup(PDFName.of('Width')).asNumber(), pixels.width);
    assert.equal(image.dict.lookup(PDFName.of('Height')).asNumber(), pixels.height);
    assert.equal(image.dict.lookup(PDFName.of('BitsPerComponent')).asNumber(), 8);
    assert.equal(image.dict.has(PDFName.of('SMask')), false);
    assert.equal(image.dict.get(PDFName.of('Filter')).toString(), '/FlateDecode');
    const profileRef = colorSpace.get(1), embedded = pdf.context.lookup(profileRef);
    profileRefs.add(profileRef.toString());
    assert.equal(embedded.dict.lookup(PDFName.of('N')).asNumber(), 4);
    assert.deepEqual(Buffer.from(decodePDFRawStream(embedded).decode()), profile);
    assert.equal(decodePDFRawStream(image).decode().length, pixels.width * pixels.height * 4);
    fourChannelPixels += pixels.width * pixels.height;
    for (const [key, value] of Object.entries(validatePageLinks(pdf, page, index, part, plan, frames))) linkCounts[key] = (linkCounts[key] || 0) + value;
  }
  assert.equal(profileRefs.size, 1);
  const allProfiles = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('N'))?.asNumber() === 4);
  assert.equal(allProfiles.length, 1, 'uploaded ICC is deduplicated once per PDF, including orphan objects');
  const artifactPath = path.join(artifacts, part.filename);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, bytes);
  return { index: part.index, filename: part.filename, artifact: path.relative(root, artifactPath), outputBytes: bytes.length, sha256: hash(bytes), validation: { pages: pdf.getPageCount(), exactPageDimensions: true, exactRasterDimensions: true, fourChannelPixels, originalUploadedIcc: true, sharedIccObjects: 1, noSoftMask: true, ...linkCounts, exactLinkRectangles: true, exactUrlsAndDestinations: true, noDuplicateAnnotations: true } };
}

try {
  const page = await context.newPage(), errors = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download));
  await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe style="width:440px;height:900px"></iframe>');
  const frame = page.frames()[1];
  await frame.setContent(html);
  await frame.waitForFunction(() => typeof createCmykExporter === 'function' && typeof startExport === 'function', null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await frame.evaluate(() => {
    window.cmykRetainedSamples = []; window.cmykLiveUrls = new Set();
    const budget = assertPdfBudget;
    assertPdfBudget = (...args) => { const bytes = budget(...args); window.cmykRetainedSamples.push({ bytes, pages: args[0].getPageCount(), partIndex: activeJob?.partIndex }); return bytes; };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.cmykLiveUrls.add(url); return url; };
    URL.revokeObjectURL = url => { window.cmykLiveUrls.delete(url); revoke(url); };
    const factory = createCmykExporter;
    window.cmykPrepared = 0; window.cmykClosed = 0;
    createCmykExporter = (...args) => {
      const exporter = factory(...args), prepare = exporter.prepare;
      exporter.prepare = async (...input) => {
        const session = await prepare(...input); window.cmykPrepared++;
        const close = session.close;
        session.close = () => { window.cmykClosed++; return close(); };
        return session;
      };
      return exporter;
    };
  });
  const cdp = await context.newCDPSession(page);
  const sample = async label => report.memorySamples.push({ label, ...await cdp.send('Runtime.getHeapUsage'), wasmHeapBytes: await frame.evaluate(async () => (await loadCmykEngine()).lcms.HEAPU8.length) });
  const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
  const waitMessage = async (types, fields = {}) => {
    types = Array.isArray(types) ? types : [types];
    const matches = ({ types, fields }) => received.some(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (message.type === 'export-failed' && key === 'index')));
    await page.waitForFunction(matches, { types, fields }, { timeout: 60000 });
    const message = await page.evaluate(({ types, fields }) => received.findLast(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (message.type === 'export-failed' && key === 'index'))), { types, fields });
    if (message.type === 'export-failed') throw new Error(message.message);
    return message;
  };
  const frames = Array.from({ length: count }, (_, index) => ({ id: `cmyk-${index}`, name: `Repeated page ${index % 2}`, parent: 'CMYK stress fixture', ...dimensions }));
  report.frames = frames;
  const fixtures = frames.map((_, index) => pageLinkFixture(index, frames));
  const connections = fixtures.flatMap(item => item.connections);
  await post({ type: 'frames-updated', frames, connections });
  await frame.locator('label[for="export-raster"]').click();
  await frame.locator('#color-profile').selectOption('CMYK');
  if (bundled) {
    assert.equal(await frame.locator('#cmyk-profile-source').inputValue(), 'BUNDLED');
    assert.equal(await frame.evaluate(() => document.getElementById('cmyk-profile').files.length), 0);
  } else {
    await frame.locator('#cmyk-profile-source').selectOption('CUSTOM');
    await frame.locator('#cmyk-profile').setInputFiles({ name: 'synthetic-test-only.icc', mimeType: 'application/vnd.iccprofile', buffer: profile });
    await frame.waitForFunction(() => selectedCmykProfile && !readingCmykProfile);
  }
  await frame.locator('#quality-select').selectOption('print-low');
  await frame.locator('#output-mode').selectOption('parts');
  await frame.locator('#pages-per-part').fill(String(pagesPerPart));
  await frame.locator('#export-btn').click();
  const request = await waitMessage('export-pdf');
  assert.deepEqual(request.selectedFrames, frames.map(frame => frame.id));
  assert.equal(request.colorProfile, 'CMYK'); assert.equal(request.exportType, 'raster');
  assert.equal(request.rasterFormat, 'PNG'); assert.equal(request.qualityScale, 2);
  report.exportRequest = { exportType: request.exportType, rasterFormat: request.rasterFormat, qualityScale: request.qualityScale, colorProfile: request.colorProfile };
  const { jobId } = request;
  await post({ type: 'export-start', jobId, frames, connections, outputColorMode: 'CMYK', exportColorProfile: 'SRGB' });
  await frame.waitForFunction(() => activeJob?.started);
  const plan = await frame.evaluate(() => activeJob.parts);
  await sample('before-pages');
  for (let index = 0; index < count; index++) {
    const generationStart = performance.now(), source = await page.evaluate(generateRaster, index);
    const generationMs = Math.round(performance.now() - generationStart);
    report.compressedInputBytes += source.inputBytes;
    const annotationPdfData = await annotationPdf(fixtures[index].nativeRecords);
    report.auxiliaryAnnotationBytes = (report.auxiliaryAnnotationBytes || 0) + annotationPdfData.length;
    const assemblyStart = performance.now();
    await page.evaluate(({ jobId, index, frame, annotationPdfData }) => {
      document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: { type: 'export-page', jobId, index, frame, format: 'PNG', data: window.nextCmykPng, annotationPdfData: new Uint8Array(annotationPdfData), outputColorMode: 'CMYK', exportColorProfile: 'SRGB' } }, '*');
      window.nextCmykPng = null;
    }, { jobId, index, frame: frames[index], annotationPdfData: Array.from(annotationPdfData) });
    const message = await waitMessage(['page-ack', 'part-ready'], { jobId, index });
    report.pages.push({ index, ...source, generationMs, assemblyToHandshakeMs: Math.round(performance.now() - assemblyStart) });
    await sample(`page-${index + 1}-${message.type}`);
    if (message.type === 'part-ready') {
      const part = plan.find(item => item.end === index + 1);
      await frame.waitForFunction(() => activeJob?.awaitingContinue, null, { timeout: 60000 });
      const download = downloads[part.index] || await page.waitForEvent('download', { timeout: 60000 });
      const paused = await frame.evaluate(() => ({ pdfReleased: activeJob.pdf === null, pageObjects: activeJob.pages.length, retainedBytes: activeJob.retainedBytes, liveUrls: window.cmykLiveUrls.size, converterClosed: window.cmykClosed }));
      assert.deepEqual(paused, { pdfReleased: true, pageObjects: 0, retainedBytes: 0, liveUrls: 1, converterClosed: 0 });
      assert.equal(await page.evaluate(({ jobId, index }) => received.some(item => item.type === 'page-ack' && item.jobId === jobId && item.index === index), { jobId, index }), false);
      report.parts.push({ ...await inspectPart(download, part, plan, frames), pausedState: paused, assemblyThroughDownloadMs: Math.round(performance.now() - assemblyStart) });
      assert.deepEqual(await frame.evaluate(() => activeJob.warnings), []);
      await sample(`part-${part.index + 1}-paused`);
      await frame.locator('#continue-btn').click();
      await waitMessage('page-ack', { jobId, index });
      assert.equal(await frame.evaluate(() => window.cmykLiveUrls.size), 0);
      await sample(`part-${part.index + 1}-released`);
    }
    console.log(`CMYK: ${index + 1}/${count} pages; ${(report.compressedInputBytes / 1048576).toFixed(1)} MiB PNG input`);
  }
  await post({ type: 'export-complete', jobId });
  await waitMessage('export-finished', { jobId });
  const last = plan.at(-1), download = downloads[last.index] || await page.waitForEvent('download', { timeout: 60000 });
  report.parts.push(await inspectPart(download, last, plan, frames));
  await sample('after-final-download');
  report.retainedBudgetSamples = await frame.evaluate(() => window.cmykRetainedSamples);
  assert.equal(downloads.length, count / pagesPerPart);
  assert.deepEqual(await frame.evaluate(() => ({ activeJob, prepared: window.cmykPrepared, closed: window.cmykClosed })), { activeJob: null, prepared: 1, closed: 1 });
  assert(report.retainedBudgetSamples.every(sample => sample.bytes <= report.retainedDataBudgetBytes));
  assert.deepEqual(errors, []);
  const linkCounts = {};
  for (const part of report.parts) for (const [key, value] of Object.entries(part.validation)) if (key.endsWith('Links') || key === 'wrappedTextLinkRectangles') linkCounts[key] = (linkCounts[key] || 0) + value;
  assert.equal(linkCounts.externalLinks, count * 3);
  assert.equal(linkCounts.localLinks + linkCounts.remoteLinks, count * 5);
  for (const key of ['remoteForwardLinks', 'remoteBackwardLinks', 'remoteJumpLinks']) assert(linkCounts[key] > 0, `${key} exercised`);
  report.validation = { outputPages: count, outputParts: report.parts.length, exactUploadedIccOncePerPart: true, exactPageAndPixelDimensions: true, noSoftMasks: true, actualFourChannelPixels: report.parts.reduce((sum, part) => sum + part.validation.fourChannelPixels, 0), ...linkCounts, exactLinkRectangles: true, exactUrlsAndDestinations: true, noDuplicateAnnotations: true, repeatedNamesResolvedByFrameId: true, intermediatePartMemoryReleased: true, conversionSessionPreparedOnceClosedOnce: true, browserErrors: errors };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack || String(error); process.exitCode = 1;
} finally {
  report.durationMs = Math.round(performance.now() - began);
  report.outputBytes = report.parts.reduce((sum, part) => sum + part.outputBytes, 0);
  report.generationMs = report.pages.reduce((sum, page) => sum + page.generationMs, 0);
  report.peakSampledJsHeapBytes = Math.max(0, ...report.memorySamples.map(sample => sample.usedSize));
  report.peakSampledBackingStorageBytes = Math.max(0, ...report.memorySamples.map(sample => sample.backingStorageSize || 0));
  report.peakSampledWasmHeapBytes = Math.max(0, ...report.memorySamples.map(sample => sample.wasmHeapBytes));
  report.peakMeasuredRetainedPdfBytes = Math.max(0, ...report.retainedBudgetSamples.map(sample => sample.bytes));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`CMYK ${report.status}: ${report.pages.length} pages, ${report.parts.length} parts, ${report.durationMs} ms; report ${output}`);
  await context.close(); await browser.close();
}
