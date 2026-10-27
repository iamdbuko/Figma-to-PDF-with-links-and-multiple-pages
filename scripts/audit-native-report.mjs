// Opt-in local corpus check. Customer PDFs and detailed results belong in ignored test-results/.
// node scripts/audit-native-report.mjs --input=/path/source.pdf --mode=rgb --dpi=72
// Add --preflight to check page-local image resources without conversion or output.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as P from 'pdf-lib';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (key, fallback) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const input = arg('input');
if (!input) throw new Error('Provide --input=/path/to/native.pdf');
const mode = arg('mode', 'rgb'), dpiValue = arg('dpi', 'original');
if (!['rgb', 'cmyk'].includes(mode)) throw new Error('Choose rgb or cmyk');
const dpi = dpiValue === 'original' ? null : Number(dpiValue);
if (dpi !== null && (!Number.isFinite(dpi) || dpi < 36 || dpi > 300)) throw new Error('Choose original or 36–300 DPI');
const destination = path.resolve(arg('output-dir', path.join(root, 'test-results/report-audit')));
const sourceBytes = await fs.readFile(input), sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const doc = await require('../src/pdf-loader.js').createPdfLoader(P).load(sourceBytes, { updateMetadata: false, throwOnInvalidObject: true });
const pages = doc.getPages(), n = P.PDFName.of;

function assertPageLocalImages(document, sourcePages) {
  // Production imports one native page at a time. This diagnostic mutates pages
  // of one document sequentially, so a shared image could be resized using only
  // its first placement, or converted to CMYK before another page uses it.
  // Traverse all resource entries conservatively, including unused entries,
  // nested Forms, fonts, masks and patterns; never follow page-tree parents.
  const owners = new WeakMap();
  let imageResources = 0, visitedObjects = 0;
  for (let index = 0; index < sourcePages.length; index++) {
    const seen = new Set(), pending = [sourcePages[index].node.Resources()];
    while (pending.length) {
      let object = pending.pop();
      if (object instanceof P.PDFRef) object = document.context.lookup(object);
      if (!object || seen.has(object)) continue;
      seen.add(object);
      if (++visitedObjects > 1000000) throw new Error('The diagnostic resource preflight exceeds its one-million-object limit.');
      if (object instanceof P.PDFRawStream) {
        if (object.dict.lookup(n('Subtype'))?.toString() === '/Image') {
          const owner = owners.get(object);
          if (owner !== undefined && owner !== index) {
            throw new Error(`This diagnostic runner cannot resize or convert cross-page shared images (pages ${owner + 1} and ${index + 1}). Use separate native-page PDFs, as production does.`);
          }
          if (owner === undefined) { owners.set(object, index); imageResources++; }
        }
        pending.push(object.dict);
      } else if (object instanceof P.PDFDict) {
        for (const value of object.values()) pending.push(value);
      } else if (object instanceof P.PDFArray) {
        for (const value of object.asArray()) pending.push(value);
      }
    }
  }
  return { imageResources, visitedObjects };
}

const resourcePreflight = dpi !== null || mode === 'cmyk' ? assertPageLocalImages(doc, pages) : null;
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ pages: pages.length, mode, dpi: dpiValue, sharedImageGuardApplied: resourcePreflight !== null, resourcePreflight }));
  process.exit(0);
}
await fs.mkdir(destination, { recursive: true });
const pageIndexes = new Map(pages.map((p, i) => [p.ref.toString(), i]));
// Keep only indices, rectangles and destination operands in memory. Never print document text.
const linkRecords = pages.map(page => (page.node.lookup(n('Annots'))?.asArray() || []).map(ref => {
  const a = doc.context.lookup(ref), action = a.lookup(n('A'));
  const dest = a.lookup(n('Dest')) || action?.lookup(n('D'));
  return { target: dest instanceof P.PDFArray ? pageIndexes.get(dest.get(0).toString()) : undefined,
    direct: a.has(n('Dest')), operands: dest instanceof P.PDFArray ? dest.asArray().slice(1) : undefined };
}));
let session;
if (mode === 'cmyk') {
  const constants = await import('lcms-wasm');
  const lcms = await constants.instantiate({ wasmBinary: new Uint8Array(await fs.readFile(require.resolve('lcms-wasm/dist/lcms.wasm'))) });
  const { createCmykExporter } = require('../src/cmyk.js');
  const exporter = createCmykExporter(P, { loadEngine: async () => ({ lcms, constants }), yieldToBrowser: () => new Promise(resolve => setImmediate(resolve)) });
  session = await exporter.prepare(new Uint8Array(await fs.readFile(path.join(root, 'assets/color-profiles/ISOcoated_v2_300_bas.ICC'))));
}
const resampler = dpi === null ? null : require('../src/pdf-image-resolution.js').createPdfImageResampler(P);
const converter = mode === 'cmyk' ? require('../src/vector-cmyk.js').createVectorCmykConverter(P) : null;
const report = { sourceSha256: sourceHash, sourceBytes: sourceBytes.length, mode, dpi: dpiValue,
  resourcePreflight,
  pages: pages.length, annotationCount: linkRecords.reduce((sum, list) => sum + list.length, 0),
  results: [], failures: [], timingScope: 'Local PDF parsing, image resizing, conversion, assembly and saving; excludes Figma rendering.' };
const started = performance.now();
try {
  for (let i = 0; i < pages.length; i++) {
    const start = performance.now();
    try {
      const resized = resampler ? await resampler.resamplePage(doc, pages[i], { dpi }) : null;
      const converted = converter ? await converter.convertPage(doc, pages[i], session) : null;
      report.results.push({ page: i + 1, ms: Math.round(performance.now() - start), resized, converted });
    } catch (error) {
      report.failures.push({ page: i + 1, error: error.message });
    }
    if ((i + 1) % 20 === 0 || i === pages.length - 1) console.log(`${i + 1}/${pages.length}; failures=${report.failures.length}`);
  }
  if (!report.failures.length) {
    const output = await P.PDFDocument.create();
    const copied = await output.copyPages(doc, pages.map((_, i) => i));
    copied.forEach(page => output.addPage(page));
    // pdf-lib doesn't reliably remap internal page references during copyPages.
    for (let i = 0; i < copied.length; i++) {
      const annots = copied[i].node.lookup(n('Annots'))?.asArray() || [];
      for (let j = 0; j < annots.length; j++) {
        const record = linkRecords[i][j];
        if (record.target === undefined) continue;
        const a = output.context.lookup(annots[j]);
        const destination = output.context.obj([copied[record.target].ref, ...record.operands]);
        if (record.direct) a.set(n('Dest'), destination);
        else a.lookup(n('A')).set(n('D'), destination);
      }
    }
    const bytes = await output.save();
    const name = `report-${mode}-${dpiValue}.pdf`;
    await fs.writeFile(path.join(destination, name), bytes);
    report.output = { filename: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
} finally {
  session?.close();
  report.elapsedMs = Math.round(performance.now() - started);
  await fs.writeFile(path.join(destination, `audit-${mode}-${dpiValue}.json`), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pages: report.pages, links: report.annotationCount, failedPages: report.failures.length, output: report.output, elapsedMs: report.elapsedMs }));
if (report.failures.length) process.exitCode = 1;
