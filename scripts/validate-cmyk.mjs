// Local conversion evidence. The printer profile is supplied explicitly and is
// never copied into the repository. Test outputs remain under test-results/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as constants from 'lcms-wasm';
const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const { createPdfColorManagement } = require('../src/color-profiles.js');
const { createCmykExporter } = require('../src/cmyk.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = process.argv[2];
if (!profilePath) throw new Error('Usage: node scripts/validate-cmyk.mjs /path/to/printer.icc');
const profile = new Uint8Array(fs.readFileSync(profilePath));
const directory = path.join(root, 'test-results/cmyk');
fs.mkdirSync(directory, { recursive: true });
const lcms = await constants.instantiate({ wasmBinary: fs.readFileSync(path.join(path.dirname(require.resolve('lcms-wasm')), 'lcms.wasm')) });
const color = createPdfColorManagement(PDFLib);
const session = await createCmykExporter(PDFLib, { loadEngine: async () => ({ lcms, constants }), getRasterProfile: color.getRasterProfile }).prepare(profile);
const html = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const helpers = html.slice(html.indexOf('// PDF_ASSEMBLY_START'), html.indexOf('// PDF_ASSEMBLY_END'));
const { appendExportPage, addExportLinks } = new Function('PDFLib', 'yieldToBrowser', 'createPdfColorManagement', `${helpers}; return {appendExportPage,addExportLinks};`)(PDFLib, () => Promise.resolve(), createPdfColorManagement);
const input = new Uint8Array(fs.readFileSync(path.join(root, 'tests/fixtures/color-profiles/swatches-SRGB.png')));
const document = await PDFLib.PDFDocument.create();
try {
  const frame = { id: 'cmyk-swatches', name: 'CMYK swatches', width: 600, height: 400 };
  const { page } = await appendExportPage(document, { frame, format: 'PNG', data: input, exportColorProfile: 'SRGB', outputColorMode: 'CMYK' }, { cmykSession: session, stillActive: () => true });
  const linkResult = await addExportLinks(document, [page], [frame], [{ fromFrameId: frame.id, type: 'external', source: 'prototype', toUrl: 'https://example.com/color', elementBounds: { x: 300, y: 240, width: 300, height: 160 } }]);
  assert.equal(linkResult.added, 1);
  const bytes = await document.save();
  fs.writeFileSync(path.join(directory, 'assembled-CMYK.pdf'), bytes);
  const loaded = await PDFLib.PDFDocument.load(bytes);
  assert.deepEqual(loaded.getPage(0).getSize(), { width: 600, height: 400 });
  const images = loaded.context.enumerateIndirectObjects().map(([, value]) => value).filter(value => value instanceof PDFLib.PDFRawStream && value.dict.get(PDFLib.PDFName.of('Subtype'))?.toString() === '/Image');
  assert.equal(images.length, 1);
  const image = images[0], space = image.dict.lookup(PDFLib.PDFName.of('ColorSpace'), PDFLib.PDFArray);
  assert.equal(space.get(0).toString(), '/ICCBased');
  const iccStream = loaded.context.lookup(space.get(1));
  assert.equal(iccStream.dict.get(PDFLib.PDFName.of('N')).asNumber(), 4);
  assert.deepEqual(PDFLib.decodePDFRawStream(iccStream).decode(), profile);
  assert.equal(image.dict.get(PDFLib.PDFName.of('SMask')), undefined);
  fs.writeFileSync(path.join(directory, 'converted-cmyk.bin'), PDFLib.decodePDFRawStream(image).decode());
  fs.writeFileSync(path.join(directory, 'source-rgb.icc'), color.getRasterProfile(document, input, 'PNG', 'SRGB').profile);
  const result = {
    input: 'native Figma sRGB swatch PNG', profile: path.basename(profilePath),
    profileBytes: profile.length, profileSHA256: crypto.createHash('sha256').update(profile).digest('hex'),
    outputBytes: bytes.length, pages: 1, pageSize: [600, 400],
    pixels: [image.dict.get(PDFLib.PDFName.of('Width')).asNumber(), image.dict.get(PDFLib.PDFName.of('Height')).asNumber()],
    imageColorSpace: 'ICCBased', components: 4, exactProfilePreserved: true,
    transparencyMask: false, prototypeLinks: linkResult.added, outputIntent: false,
    note: 'Local conversion evidence only. No physical print verification.'
  };
  fs.writeFileSync(path.join(directory, 'assembly-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { session.close(); }
