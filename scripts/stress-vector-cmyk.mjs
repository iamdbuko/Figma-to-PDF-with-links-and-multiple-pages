// Opt-in isolated-browser benchmark. No Figma APIs or user browser are controlled.
// PDF_EXPORT_TEST_UI=/path/to/temporary-ui.html node scripts/stress-vector-cmyk.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const inputPath = path.resolve(root, arg('input', 'test-results/combined-large/live/combined-dev6-vector.pdf'));
const outputPath = path.resolve(root, arg('output', 'docs/vector-cmyk-stress-results.json'));
const artifacts = path.join(root, 'test-results/vector-cmyk/stress');
const html = await fs.readFile(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8');
const sourceBytes = await fs.readFile(inputPath);
const profile = await fs.readFile(path.join(root, 'assets/color-profiles/ISOcoated_v2_300_bas.ICC'));
const hash = value => createHash('sha256').update(value).digest('hex');
const n = PDFName.of;
const dimensions = { width: 3840, height: 2880 }, prototypeRect = [100, 360, 400, 480];
const source = await PDFDocument.load(sourceBytes), count = source.getPageCount();
assert.equal(count, 6, 'this fixture expects six native-export-derived pages');
const refIndexes = new Map(source.getPages().map((page, index) => [page.ref.toString(), index]));
const frames = Array.from({ length: count }, (_, index) => ({ id: `101:${index + 1}`, name: 'Combined large report', parent: 'Prior Figma native fixture', ...dimensions }));
const connections = [], fixtures = [];
const rectKey = rect => JSON.stringify(rect);
const contentText = (document, page) => {
  const contents = page.node.lookup(n('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => document.context.lookup(ref)) : [contents];
  return streams.map(stream => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
};
const operatorCounts = text => ({
  textShows: text.match(/\bT[Jj]\b/g)?.length || 0,
  pathPaints: text.split(/\r?\n/).filter(line => /(?:^|\s)(?:f\*?|F|S|s|B\*?|b\*?)\s*$/.test(line)).length
});
const imageObjects = (document, page) => page.node.Resources().lookup(n('XObject'), PDFDict).values()
  .map(ref => document.context.lookup(ref)).filter(object => object instanceof PDFRawStream && object.dict.get(n('Subtype'))?.toString() === '/Image');
const maskInfo = (document, image) => {
  const value = image.dict.get(n('SMask'));
  if (!value) return null;
  const mask = document.context.lookup(value, PDFRawStream);
  return { width: mask.dict.lookup(n('Width')).asNumber(), height: mask.dict.lookup(n('Height')).asNumber(),
    bits: mask.dict.lookup(n('BitsPerComponent')).asNumber(), colorSpace: mask.dict.get(n('ColorSpace')).toString(), sha256: hash(decodePDFRawStream(mask).decode()) };
};

// Resolve every original page reference before replacing Dest actions. This
// prevents one-page copies from importing the other five pages through links.
for (const [index, page] of source.getPages().entries()) {
  assert.deepEqual(page.getSize(), dimensions);
  const expected = [], keep = [], annots = page.node.lookup(n('Annots'), PDFArray);
  for (const ref of annots.asArray()) {
    const annotation = source.context.lookup(ref, PDFDict);
    assert.equal(annotation.get(n('Subtype')).toString(), '/Link');
    const rect = annotation.lookup(n('Rect'), PDFArray).asArray().map(value => value.asNumber());
    const action = annotation.lookupMaybe(n('A'), PDFDict);
    const destination = annotation.lookupMaybe(n('Dest'), PDFArray) || (action?.get(n('S'))?.toString() === '/GoTo' ? action.lookup(n('D'), PDFArray) : null);
    const prototype = rectKey(rect) === rectKey(prototypeRect);
    const bounds = { x: rect[0], y: dimensions.height - rect[3], width: rect[2] - rect[0], height: rect[3] - rect[1] };
    const link = { fromFrameId: frames[index].id, source: prototype ? 'prototype' : 'text', elementBounds: bounds };
    if (!prototype) Object.assign(link, { needsTextGeometry: true, textNodeId: `source-text-${index}-${expected.length}` });
    if (destination) {
      const targetIndex = refIndexes.get(destination.get(0).toString());
      assert.notEqual(targetIndex, undefined, 'original internal destination resolves to one of the six pages');
      expected.push({ rect, source: link.source, targetIndex });
      Object.assign(link, { type: 'internal', toFrameId: frames[targetIndex].id, toNodeId: frames[targetIndex].id });
      annotation.delete(n('Dest'));
      annotation.set(n('A'), source.context.obj({ S: 'URI', URI: PDFString.of(`https://www.figma.com/design/vectorCmykStress/Prior-fixture?node-id=${frames[targetIndex].id.replace(':', '-')}`) }));
    } else {
      assert.equal(action?.get(n('S'))?.toString(), '/URI');
      const url = action.lookup(n('URI')).decodeText();
      expected.push({ rect, source: link.source, url });
      Object.assign(link, { type: 'external', toUrl: url });
    }
    connections.push(link);
    if (!prototype) keep.push(ref);
  }
  assert.equal(expected.length, 8); assert.equal(new Set(expected.map(record => rectKey(record.rect))).size, 8);
  assert.equal(expected.filter(record => record.url).length, 5);
  assert.equal(expected.filter(record => record.url?.endsWith('/wrapped')).length, 3);
  assert.equal(expected.find(record => record.source === 'prototype').targetIndex, (index + 1) % count);
  assert.deepEqual(expected.filter(record => record.targetIndex !== undefined && record.source === 'text').map(record => record.targetIndex).sort((a, b) => a - b), [(index + 1) % count, (index + count - 1) % count].sort((a, b) => a - b));
  page.node.set(n('Annots'), source.context.obj(keep));
  const images = imageObjects(source, page);
  assert.equal(images.length, 1);
  const image = images[0], width = image.dict.lookup(n('Width')).asNumber(), height = image.dict.lookup(n('Height')).asNumber();
  assert.deepEqual({ width, height }, dimensions);
  const operations = operatorCounts(contentText(source, page));
  assert(operations.textShows > 0 && operations.pathPaints > 0);
  fixtures.push({ expected, image: { width, height, pixels: width * height, compressedBytes: image.getContents().length, sha256: hash(image.getContents()), softMask: maskInfo(source, image) }, operations });
}
const pageInputs = [];
for (let index = 0; index < count; index++) {
  const document = await PDFDocument.create(), [page] = await document.copyPages(source, [index]);
  document.addPage(page);
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFDict && value.get(n('Type'))?.toString() === '/Page').length, 1, 'no orphan copied pages');
  pageInputs.push(await document.save());
}
const report = {
  recordedAt: new Date().toISOString(), builtUiSha256: hash(html), platform: process.platform, status: 'running',
  source: { file: path.relative(root, inputPath), bytes: sourceBytes.length, sha256: hash(sourceBytes), pages: count, pageDimensions: dimensions, embeddedPixelsPerPage: dimensions.width * dimensions.height,
    pageInputBytes: pageInputs.map(bytes => bytes.length), compressedPageInputBytes: pageInputs.reduce((sum, bytes) => sum + bytes.length, 0),
    imageHashes: fixtures.map(item => item.image.sha256), repeatedImage: new Set(fixtures.map(item => item.image.sha256)).size === 1 },
  profile: { source: 'BUNDLED', name: 'ISO Coated v2 300% (basICColor)', sha256: hash(profile), bytes: profile.length },
  scope: 'Actual built UI, pdf-lib, offline JPEG decoder and LittleCMS in isolated headless Chromium. The six-page input is a prior plugin vector export from native Figma rendering, with one 3840x2880 JPEG and text/paths per page. The same synthetic chart image repeats on all pages; this is not a diverse photograph corpus. No fresh Figma exportAsync, plugin backend, scanner, real print device or physical color proof is exercised.',
  normalization: 'The harness resolves original Dest page references, changes internal text actions into Figma NODE URI actions, removes the prototype annotation and supplies scanner-shaped metadata, then copies each source page independently. Original URLs, exact rectangles and global targets are the validation oracle. These URI actions/scanner messages and repeated frame names are harness-generated, not captured native Figma messages.',
  validationScope: 'Saved PDFs are reloaded to check every annotation rectangle and URL/local reference/relative filename/page destination, native text/path operator counts, image dimensions, actual four-channel sample lengths, preserved soft masks, and exact built-in ICC bytes once per output including orphan objects. Viewer navigation, visual color appearance and print behavior require separate validation.',
  timingScope: 'Scenario duration includes isolated UI setup, sequential message delivery, conversion, downloads and Node-side saved-PDF validation. Per-page assemblyToHandshakeMs covers delivery through the UI acknowledgement or part-ready message; it excludes later part validation. No Figma export time is included.',
  memoryScope: 'CDP Runtime.getHeapUsage samples V8 usedSize/backingStorageSize; WASM heap length is separate and may overlap backing storage. These samples exclude full browser/Figma/native decoder/GPU process memory and can miss transient peaks. Node fixture preparation/PDF inspection is outside renderer samples. No forced garbage collection.',
  retainedPdfLimitBytes: 128 * 1024 * 1024, scenarios: []
};

function inspectAnnotations(document, page) {
  return page.node.lookup(n('Annots'), PDFArray).asArray().map(ref => document.context.lookup(ref, PDFDict)).map(annotation => {
    const action = annotation.lookupMaybe(n('A'), PDFDict), dest = annotation.lookupMaybe(n('Dest'), PDFArray), remote = action?.lookupMaybe(n('D'), PDFArray);
    return { rect: annotation.lookup(n('Rect'), PDFArray).asArray().map(value => value.asNumber()),
      action: action?.get(n('S'))?.toString(), url: action?.get(n('URI'))?.decodeText(),
      destination: dest?.get(0).toString(), fit: dest?.get(1).toString(),
      remoteFile: action?.get(n('F'))?.decodeText(), remotePage: remote?.get(0).asNumber(), remoteFit: remote?.get(1).toString() };
  });
}
async function inspectPart(download, part, plan, scenarioName) {
  assert.equal(download.suggestedFilename(), part.filename);
  const bytes = await fs.readFile(await download.path()), document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), part.end - part.start);
  const allProfiles = document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(n('N'))?.asNumber() === 4);
  assert.equal(allProfiles.length, 1, 'exactly one destination ICC, including orphan objects');
  assert.deepEqual(Buffer.from(decodePDFRawStream(allProfiles[0][1]).decode()), profile);
  const canonicalRef = allProfiles[0][0].toString();
  const result = { pages: document.getPageCount(), annotations: 0, externalLinks: 0, internalTextLinks: 0, prototypeLinks: 0, localLinks: 0, remoteLinks: 0, actualFourChannelPixels: 0, textShows: 0, pathPaints: 0 };
  for (let local = 0; local < document.getPageCount(); local++) {
    const index = part.start + local, page = document.getPage(local), fixture = fixtures[index];
    assert.deepEqual(page.getSize(), dimensions);
    const operations = operatorCounts(contentText(document, page));
    assert.deepEqual(operations, fixture.operations, 'native text and painted vector paths survive');
    result.textShows += operations.textShows; result.pathPaints += operations.pathPaints;
    const images = imageObjects(document, page); assert.equal(images.length, 1, 'no whole-page replacement image added');
    const image = images[0];
    assert.equal(image.dict.lookup(n('Width')).asNumber(), fixture.image.width);
    assert.equal(image.dict.lookup(n('Height')).asNumber(), fixture.image.height);
    assert.equal(image.dict.lookup(n('BitsPerComponent')).asNumber(), 8);
    const space = image.dict.lookup(n('ColorSpace'), PDFArray);
    assert.equal(space.get(0).toString(), '/ICCBased'); assert.equal(space.get(1).toString(), canonicalRef);
    assert.equal(decodePDFRawStream(image).decode().length, fixture.image.pixels * 4);
    assert.deepEqual(maskInfo(document, image), fixture.image.softMask, 'native alpha mask remains exact');
    result.actualFourChannelPixels += fixture.image.pixels;
    const actual = inspectAnnotations(document, page);
    assert.equal(actual.length, 8); result.annotations += actual.length;
    assert.equal(new Set(actual.map(item => JSON.stringify(item))).size, 8, 'no duplicate annotations');
    for (const wanted of fixture.expected) {
      const candidates = actual.filter(item => rectKey(item.rect) === rectKey(wanted.rect));
      assert.equal(candidates.length, 1, 'each original rectangle is preserved exactly once');
      const found = candidates[0];
      if (wanted.url) {
        assert.equal(found.action, '/URI'); assert.equal(found.url, wanted.url);
        assert.equal(found.destination, undefined); assert.equal(found.remoteFile, undefined); result.externalLinks++;
      } else {
        assert.equal(found.url, undefined);
        wanted.source === 'text' ? result.internalTextLinks++ : result.prototypeLinks++;
        const target = plan.find(item => wanted.targetIndex >= item.start && wanted.targetIndex < item.end);
        if (target.index === part.index) {
          assert.equal(found.destination, document.getPage(wanted.targetIndex - part.start).ref.toString());
          assert.equal(found.fit, '/Fit'); assert.equal(found.action, undefined); result.localLinks++;
        } else {
          assert.equal(found.action, '/GoToR'); assert.equal(found.remoteFile, target.filename);
          assert.equal(found.remotePage, wanted.targetIndex - target.start); assert.equal(found.remoteFit, '/Fit');
          assert.equal(found.destination, undefined); result.remoteLinks++;
        }
      }
    }
  }
  const target = path.join(artifacts, scenarioName, part.filename);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  return { index: part.index, filename: part.filename, artifact: path.relative(root, target), outputBytes: bytes.length, sha256: hash(bytes), validation: { ...result, exactIccObjects: 1, exactIccBytes: true, exactPageAndImageDimensions: true, exactSoftMasks: true, exactUrlsRectanglesAndDestinations: true, textAndPathsRetained: true } };
}

const browser = await chromium.launch({ headless: true });
report.browser = browser.version();
const totalStart = performance.now();
async function runScenario(name, pagesPerPart, cancel = false) {
  const result = { name, pagesPerPart, status: 'running', pages: [], parts: [], warnings: [], memorySamples: [], retainedSamples: [] };
  report.scenarios.push(result);
  const began = performance.now(), context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage(), errors = [], downloads = [], network = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('download', download => downloads.push(download));
    page.on('request', request => network.push(request.url()));
    await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe style="width:440px;height:900px"></iframe>');
    const frame = page.frames()[1]; await frame.setContent(html);
    await frame.waitForFunction(() => typeof startExport === 'function' && typeof createVectorCmykConverter === 'function', null, { timeout: 5000 });
    await frame.evaluate(() => {
      window.liveUrls = new Set(); window.vectorPrepared = 0; window.vectorClosed = 0; window.imageConversions = 0;
      window.imageConversionActive = false; window.completedChunkChecks = 0; window.closeDuringImageConversion = false;
      window.retainedSamples = []; window.anchorDownloads = 0;
      const budget = assertPdfBudget;
      assertPdfBudget = (...args) => { const bytes = budget(...args); window.retainedSamples.push({ bytes, pages: args[0].getPageCount() }); return bytes; };
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = blob => { const url = create(blob); window.liveUrls.add(url); return url; };
      URL.revokeObjectURL = url => { window.liveUrls.delete(url); return revoke(url); };
      HTMLAnchorElement.prototype.click = function () { window.anchorDownloads++; return click.call(this); };
      const factory = createCmykExporter;
      createCmykExporter = (...args) => {
        const exporter = factory(...args), prepare = exporter.prepare;
        exporter.prepare = async (...input) => {
          const session = await prepare(...input); window.vectorPrepared++;
          const close = session.close, convert = session.convertRgb8;
          session.close = () => { window.closeDuringImageConversion ||= window.imageConversionActive; window.vectorClosed++; return close(); };
          session.convertRgb8 = async (rgb, profile, options) => {
            window.imageConversions++; window.imageConversionActive = true;
            try { return await convert(rgb, profile, { ...options, stillActive: () => { window.completedChunkChecks++; return options.stillActive(); } }); }
            finally { window.imageConversionActive = false; }
          };
          return session;
        };
        return exporter;
      };
    });
    assert.deepEqual(await frame.evaluate(() => ({ prepared: window.vectorPrepared, closed: window.vectorClosed })), { prepared: 0, closed: 0 });
    const cdp = await context.newCDPSession(page);
    const sample = async label => result.memorySamples.push({ label, ...await cdp.send('Runtime.getHeapUsage'), wasmHeapBytes: await frame.evaluate(async () => (await loadCmykEngine()).lcms.HEAPU8.length) });
    const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
    const waitMessage = async (types, fields = {}) => {
      types = Array.isArray(types) ? types : [types];
      const match = ({ types, fields }) => received.some(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (message.type === 'export-failed' && key === 'index')));
      await page.waitForFunction(match, { types, fields }, { timeout: 60000 });
      const message = await page.evaluate(({ types, fields }) => received.findLast(message => (types.includes(message.type) || message.type === 'export-failed') && Object.entries(fields).every(([key, value]) => message[key] === value || (message.type === 'export-failed' && key === 'index'))), { types, fields });
      if (message.type === 'export-failed') throw new Error(message.message);
      return message;
    };
    await post({ type: 'frames-updated', frames, connections });
    await frame.locator('label[for="export-vector"]').click(); await frame.locator('#color-profile').selectOption('CMYK');
    assert.equal(await frame.locator('#cmyk-profile-source').inputValue(), 'BUNDLED');
    if (pagesPerPart < count) { await frame.locator('#output-mode').selectOption('parts'); await frame.locator('#pages-per-part').fill(String(pagesPerPart)); }
    await frame.locator('#export-btn').click();
    const request = await waitMessage('export-pdf'), { jobId } = request;
    assert.equal(request.exportType, 'vector'); assert.equal(request.colorProfile, 'CMYK');
    assert.deepEqual(request.selectedFrames, frames.map(item => item.id));
    await post({ type: 'export-start', jobId, frames, connections, exportColorProfile: 'SRGB', outputColorMode: 'CMYK' });
    await frame.waitForFunction(() => activeJob?.started);
    const plan = await frame.evaluate(() => activeJob.parts);
    await sample('before-pages');
    for (let index = 0; index < count; index++) {
      const assemblyStart = performance.now();
      await post({ type: 'export-page', jobId, index, frame: frames[index], format: 'PDF', data: Array.from(pageInputs[index]), exportColorProfile: 'SRGB', outputColorMode: 'CMYK' });
      if (cancel) {
        await frame.waitForFunction(() => window.imageConversionActive && window.completedChunkChecks >= 3, null, { timeout: 60000 });
        await sample('during-real-image-conversion');
        await frame.locator('#cancel-btn').click(); await waitMessage('export-cancel', { jobId });
        await post({ type: 'export-cancelled', jobId });
        await frame.waitForFunction(() => activeJob === null, null, { timeout: 60000 });
        const cleanup = await frame.evaluate(() => ({ activeJob, prepared: window.vectorPrepared, closed: window.vectorClosed, imageConversions: window.imageConversions, completedChunkChecks: window.completedChunkChecks, imageConversionActive: window.imageConversionActive, closeDuringImageConversion: window.closeDuringImageConversion, liveUrls: window.liveUrls.size, anchorDownloads: window.anchorDownloads }));
        assert.equal(cleanup.activeJob, null); assert.equal(cleanup.prepared, 1); assert.equal(cleanup.closed, 1);
        assert.equal(cleanup.imageConversions, 1); assert(cleanup.completedChunkChecks >= 3);
        assert.equal(cleanup.imageConversionActive, false); assert.equal(cleanup.closeDuringImageConversion, false);
        assert.equal(cleanup.liveUrls, 0); assert.equal(cleanup.anchorDownloads, 0); assert.equal(downloads.length, 0);
        assert.equal(await page.evaluate(id => received.some(item => item.jobId === id && ['page-ack', 'part-ready', 'export-finished'].includes(item.type)), jobId), false);
        assert.equal(await frame.locator('#export-btn').isEnabled(), true);
        result.cleanup = cleanup; await sample('after-cancel-cleanup'); break;
      }
      const message = await waitMessage(['page-ack', 'part-ready'], { jobId, index });
      assert.notEqual(message.fallback, true, 'vector CMYK must never request raster fallback');
      result.warnings = await frame.evaluate(() => [...activeJob.warnings]);
      result.pages.push({ index, inputBytes: pageInputs[index].length, assemblyToHandshakeMs: Math.round(performance.now() - assemblyStart) });
      await sample(`page-${index + 1}-${message.type}`);
      if (message.type === 'part-ready') {
        const part = plan.find(item => item.end === index + 1);
        await frame.waitForFunction(() => activeJob?.awaitingContinue, null, { timeout: 60000 });
        const download = downloads[part.index] || await page.waitForEvent('download', { timeout: 60000 });
        const paused = await frame.evaluate(() => ({ pdfReleased: activeJob.pdf === null, pages: activeJob.pages.length, retainedBytes: activeJob.retainedBytes, liveUrls: window.liveUrls.size, closed: window.vectorClosed }));
        assert.deepEqual(paused, { pdfReleased: true, pages: 0, retainedBytes: 0, liveUrls: 1, closed: 0 });
        assert.equal(await page.evaluate(({ jobId, index }) => received.some(item => item.type === 'page-ack' && item.jobId === jobId && item.index === index), { jobId, index }), false);
        result.parts.push({ ...await inspectPart(download, part, plan, name), pausedState: paused });
        await frame.locator('#continue-btn').click(); await waitMessage('page-ack', { jobId, index });
        assert.equal(await frame.evaluate(() => window.liveUrls.size), 0);
        await sample(`part-${part.index + 1}-released`);
      }
      console.log(`${name}: ${index + 1}/${count} native-derived pages processed`);
    }
    if (!cancel) {
      await post({ type: 'export-complete', jobId }); await waitMessage('export-finished', { jobId });
      const part = plan.at(-1), download = downloads[part.index] || await page.waitForEvent('download', { timeout: 60000 });
      result.parts.push(await inspectPart(download, part, plan, name));
      assert.equal(downloads.length, plan.length);
      assert.deepEqual(await frame.evaluate(() => ({ activeJob, prepared: window.vectorPrepared, closed: window.vectorClosed, imageConversions: window.imageConversions, closeDuringImageConversion: window.closeDuringImageConversion })), { activeJob: null, prepared: 1, closed: 1, imageConversions: 6, closeDuringImageConversion: false });
      result.validation = Object.fromEntries(['pages', 'annotations', 'externalLinks', 'internalTextLinks', 'prototypeLinks', 'localLinks', 'remoteLinks', 'actualFourChannelPixels', 'textShows', 'pathPaints'].map(key => [key, result.parts.reduce((sum, item) => sum + item.validation[key], 0)]));
      assert.equal(result.validation.annotations, 48); assert.equal(result.validation.externalLinks, 30);
      assert.equal(result.validation.remoteLinks, pagesPerPart === count ? 0 : 9);
      await sample('after-final-download');
    }
    result.retainedSamples = await frame.evaluate(() => window.retainedSamples);
    assert(result.retainedSamples.every(item => item.bytes <= report.retainedPdfLimitBytes));
    assert.deepEqual(network, [], 'all conversion resources are offline'); assert.deepEqual(errors, []);
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack || String(error); throw error; }
  finally {
    result.durationMs = Math.round(performance.now() - began);
    result.outputBytes = result.parts.reduce((sum, item) => sum + item.outputBytes, 0);
    result.peakSampledJsHeapBytes = Math.max(0, ...result.memorySamples.map(item => item.usedSize));
    result.peakSampledBackingStorageBytes = Math.max(0, ...result.memorySamples.map(item => item.backingStorageSize || 0));
    result.peakSampledWasmHeapBytes = Math.max(0, ...result.memorySamples.map(item => item.wasmHeapBytes));
    result.peakMeasuredRetainedPdfBytes = Math.max(0, ...result.retainedSamples.map(item => item.bytes));
    await context.close();
  }
}
try {
  await runScenario('single-pdf', 6);
  await runScenario('three-parts', 2);
  await runScenario('cancel-during-image-conversion', 6, true);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  report.durationMs = Math.round(performance.now() - totalStart);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(`Vector CMYK stress ${report.status}; report ${outputPath}`);
}
