// Historical benchmark for the previous cumulative 128 MiB input limit.
// Kept to explain docs/stress-results.json; current benchmark: stress-large.mjs.
// Do not use this harness to evaluate the current retained-data budget.
// Uses a new headless browser, never the user's browser or Figma account.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await fs.readFile(path.join(root, 'ui.html'), 'utf8');
const nativePdf = await fs.readFile(path.join(root, 'tests/fixtures/native-links.pdf'));
const transferLimit = 128 * 1024 * 1024;
const output = path.join(root, 'docs/stress-results.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const browser = await chromium.launch({ headless: true });
let report = {
  recordedAt: new Date().toISOString(), browser: browser.version(), platform: process.platform,
  builtUiSha256: hash(html), nativeFixtureSha256: hash(nativePdf), transferLimitBytes: transferLimit,
  scope: 'Built plugin UI and bundled pdf-lib in isolated headless Chromium; real Figma native PDF fixture and synthetic PNGs. Figma exportAsync, document traversal, backend message handling, plugin sandbox, and Figma process memory are not included. The harness enforces the same 128 MiB transfer threshold and cancels before sending an over-budget page; backend guard behavior is covered separately by protocol tests.',
  memoryScope: 'CDP Runtime.getHeapUsage is sampled after each acknowledged page. usedSize and totalSize measure JavaScript heap in the renderer; embedderHeapUsedSize and backingStorageSize, when available, are separate V8-reported values. These are not whole-browser, native decoder, GPU, or Figma memory measurements. No forced garbage collection.',
  rasterSource: 'Deterministic synthetic landscape: full-resolution color gradients and curved terrain with a low-resolution seeded noise overlay enlarged smoothly. Every page has different colors, terrain, and texture. This is a compressible image workload, not a real-photo corpus or worst-case entropy test.',
  scenarios: []
};
if (process.argv.includes('--append')) {
  const previous = JSON.parse(await fs.readFile(output, 'utf8'));
  report.scenarios = previous.scenarios.map(scenario => ({ builtUiSha256: previous.builtUiSha256, ...scenario }));
  report.previousRecordedAt = previous.recordedAt;
}
const persist = async () => { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };

function annotations(document, page) {
  const list = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!list) return [];
  const records = [];
  for (let i = 0; i < list.size(); i++) {
    const item = document.context.lookup(list.get(i), PDFDict);
    if (item.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
    const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
    const uri = action?.get(PDFName.of('URI'));
    const rect = item.lookup(PDFName.of('Rect'), PDFArray).asArray().map(number => number.asNumber());
    const dest = item.lookupMaybe(PDFName.of('Dest'), PDFArray);
    records.push({ uri: uri?.decodeText(), rect, destination: dest?.get(0)?.toString() });
  }
  return records;
}

async function runScenario(name, count, format, lowTexture = false) {
  const context = await browser.newContext({ acceptDownloads: true });
  const result = { name, requestedPages: count, format, builtUiSha256: hash(html), status: 'running', pages: [], compressedInputBytes: 0 };
  if (lowTexture) result.sourceVariation = 'Lower-complexity control: 24×14 noise field, 8% overlay, RGB channels rounded to 8-value steps before PNG encoding. Full-resolution gradients and terrain are retained. This deliberately compressible control does not represent detailed photographs.';
  report.scenarios.push(result);
  const began = performance.now();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<script>window.received=[];addEventListener("message",event=>{if(event.data?.pluginMessage)received.push(event.data.pluginMessage)})</script><iframe title="Plugin UI" style="width:420px;height:720px"></iframe>');
    const frame = page.frames()[1];
    await frame.setContent(html);
    await frame.waitForFunction(() => typeof startExport === 'function', null, { timeout: 5000 });
    assert.deepEqual(errors, []);
    const cdp = await context.newCDPSession(page);
    const post = message => page.evaluate(message => document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: message }, '*'), message);
    const waitForMessage = async (type, fields = {}, timeout = 30000) => {
      await page.waitForFunction(({ type, fields }) => received.some(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)) || received.some(message => message.type === 'export-failed'), { type, fields }, { timeout });
      const failure = await page.evaluate(() => received.find(message => message.type === 'export-failed'));
      if (failure) throw new Error(failure.message);
      return page.evaluate(({ type, fields }) => received.findLast(message => message.type === type && Object.entries(fields).every(([key, value]) => message[key] === value)), { type, fields });
    };
    const width = format === 'PDF' ? 600 : 3840, height = format === 'PDF' ? 400 : 2160;
    const frames = Array.from({ length: count }, (_, i) => ({ id: `stress-${format}-${i}`, name: `Repeated name ${i % 3}`, parent: 'Stress fixture', width, height }));
    // Duplicate names deliberately verify destination identity comes from frame IDs.
    const connections = frames.map((item, i) => ({ source: 'prototype', type: 'internal', fromFrameId: item.id, toFrameId: frames[(i + 1) % count].id, elementBounds: { x: 10, y: 10, width: 40, height: 20 } }));
    await post({ type: 'frames-updated', frames, connections, justAdded: frames.map(item => item.id) });
    await frame.locator('#export-btn').click();
    const request = await waitForMessage('export-pdf');
    assert.deepEqual(request.selectedFrames, frames.map(item => item.id));
    const jobId = request.jobId;
    await post({ type: 'export-start', jobId, frames, connections });
    await frame.waitForFunction(() => activeJob?.started);
    result.pageDimensions = { width, height };
    if (format === 'PNG') result.rasterDimensions = { width: 5760, height: 3240, scale: 1.5, pixels: 5760 * 3240 };
    result.heapBeforePages = await cdp.send('Runtime.getHeapUsage');
    for (let index = 0; index < count; index++) {
      const generationStart = performance.now();
      const bytes = format === 'PDF' ? nativePdf.length : await page.evaluate(async ({ index, lowTexture }) => {
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
        noise.width = lowTexture ? 24 : 192; noise.height = lowTexture ? 14 : 108;
        const nc = noise.getContext('2d');
        const pixels = nc.createImageData(noise.width, noise.height);
        let seed = (index + 1) * 1234567;
        for (let p = 0; p < pixels.data.length; p += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const value = 110 + (seed >>> 27);
          pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = value;
          pixels.data[p + 3] = 255;
        }
        nc.putImageData(pixels, 0, 0);
        context.globalCompositeOperation = 'soft-light'; context.globalAlpha = lowTexture ? .08 : .35;
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(noise, 0, 0, width, height);
        context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
        if (lowTexture) {
          const quantized = context.getImageData(0, 0, width, height);
          for (let p = 0; p < quantized.data.length; p += 4) {
            quantized.data[p] = Math.round(quantized.data[p] / 8) * 8;
            quantized.data[p + 1] = Math.round(quantized.data[p + 1] / 8) * 8;
            quantized.data[p + 2] = Math.round(quantized.data[p + 2] / 8) * 8;
          }
          context.putImageData(quantized, 0, 0);
        }
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Canvas PNG encoding failed');
        window.nextStressPng = new Uint8Array(await blob.arrayBuffer());
        return window.nextStressPng.length;
      }, { index, lowTexture });
      const generationMs = performance.now() - generationStart;
      if (result.compressedInputBytes + bytes > transferLimit) {
        result.status = 'transfer-limit'; result.nextPageBytes = bytes;
        await frame.locator('#cancel-btn').click();
        await post({ type: 'export-cancelled', jobId });
        await frame.waitForFunction(() => activeJob === null);
        break;
      }
      result.compressedInputBytes += bytes;
      const assemblyStart = performance.now();
      if (format === 'PDF') await post({ type: 'export-page', jobId, index, frame: frames[index], format, data: [...nativePdf] });
      else await page.evaluate(({ jobId, index, frame }) => {
        document.querySelector('iframe').contentWindow.postMessage({ pluginMessage: { type: 'export-page', jobId, index, frame, format: 'PNG', data: window.nextStressPng } }, '*');
        window.nextStressPng = null;
      }, { jobId, index, frame: frames[index] });
      const ack = await waitForMessage('page-ack', { jobId, index });
      assert.equal(ack.fallback, undefined, 'benchmark input must not need a fallback');
      result.pages.push({ index, inputBytes: bytes, generationMs: Math.round(generationMs), assemblyMs: Math.round(performance.now() - assemblyStart), heap: await cdp.send('Runtime.getHeapUsage') });
      if ((index + 1) % (format === 'PDF' ? 50 : 5) === 0) console.log(`${name}: ${index + 1}/${count} acknowledged; ${(result.compressedInputBytes / 1048576).toFixed(1)} MiB compressed input`);
    }
    if (result.status === 'running') {
      const saveStart = performance.now();
      const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
      await post({ type: 'export-complete', jobId });
      const download = await downloadPromise;
      await waitForMessage('export-finished', { jobId }, 120000);
      const bytes = await fs.readFile(await download.path());
      result.finalizeAndDownloadMs = Math.round(performance.now() - saveStart);
      result.outputBytes = bytes.length;
      result.heapAfterDownload = await cdp.send('Runtime.getHeapUsage');
      const document = await PDFDocument.load(bytes);
      assert.equal(document.getPageCount(), count);
      const fixture = await PDFDocument.load(nativePdf);
      const expectedNative = annotations(fixture, fixture.getPage(0));
      let nativeLinks = 0, internalLinks = 0;
      for (let index = 0; index < count; index++) {
        const outputPage = document.getPage(index);
        assert.deepEqual(outputPage.getSize(), { width, height });
        const links = annotations(document, outputPage);
        if (format === 'PDF') {
          const uris = links.filter(link => link.uri !== undefined);
          assert.deepEqual(uris, expectedNative, 'native URI annotations and precise rectangles preserved');
          nativeLinks += uris.length;
        } else {
          const xobjects = outputPage.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
          const images = xobjects.values().map(ref => document.context.lookup(ref)).filter(object => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
          assert.equal(images.length, 1);
          assert.equal(images[0].dict.lookup(PDFName.of('Width')).asNumber(), 5760);
          assert.equal(images[0].dict.lookup(PDFName.of('Height')).asNumber(), 3240);
        }
        const internal = links.filter(link => link.destination);
        assert.equal(internal.length, 1);
        assert.equal(internal[0].destination, document.getPage((index + 1) % count).ref.toString());
        assert.deepEqual(internal[0].rect, [10, height - 30, 50, height - 10]);
        internalLinks++;
      }
      result.validation = { outputPages: document.getPageCount(), exactPageDimensions: true, exactRasterPixelDimensions: format === 'PNG' ? true : null, preservedNativeUriAnnotations: nativeLinks, correctInternalDestinations: internalLinks, repeatedNamesResolvedByFrameId: true, browserErrors: errors };
      assert.deepEqual(errors, []);
      result.status = 'passed';
    }
  } catch (error) {
    result.status = 'failed'; result.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    result.durationMs = Math.round(performance.now() - began);
    result.acknowledgedPages = result.pages.length;
    result.generationMs = result.pages.reduce((sum, page) => sum + page.generationMs, 0);
    result.pageAssemblyMs = result.pages.reduce((sum, page) => sum + page.assemblyMs, 0);
    result.peakSampledJsHeapBytes = Math.max(result.heapBeforePages?.usedSize || 0, result.heapAfterDownload?.usedSize || 0, ...result.pages.map(page => page.heap.usedSize));
    result.peakSampledBackingStorageBytes = Math.max(result.heapBeforePages?.backingStorageSize || 0, result.heapAfterDownload?.backingStorageSize || 0, ...result.pages.map(page => page.heap.backingStorageSize || 0));
    result.transferBudgetUsedPercent = +(result.compressedInputBytes / transferLimit * 100).toFixed(2);
    console.log(`${name}: ${result.status}, ${result.acknowledgedPages} pages, ${result.durationMs} ms`);
    await persist();
    await context.close();
  }
}

try {
  const requested = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
  if (!requested.length || requested.includes('native')) await runScenario('250 native PDF pages with preserved links', 250, 'PDF');
  if (!requested.length || requested.includes('raster')) await runScenario('30 large raster pages at 1.5x', 30, 'PNG');
  if (!requested.length || requested.includes('raster-low')) await runScenario('30 large raster pages at 1.5x, lower texture control', 30, 'PNG', true);
} finally {
  await browser.close();
  await persist();
}
console.log(`Results: ${output}`);
