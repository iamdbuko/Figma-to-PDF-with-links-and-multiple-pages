// Reproduce PDF assembly from small native Figma color fixtures. Rendering and
// colorimetric comparisons are recorded separately in docs/color-results.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const { createPdfColorManagement } = require('../src/color-profiles.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const helpers = html.slice(html.indexOf('// PDF_ASSEMBLY_START'), html.indexOf('// PDF_ASSEMBLY_END'));
const { appendExportPage, addExportLinks } = new Function('PDFLib', 'yieldToBrowser', 'createPdfColorManagement', `${helpers}; return {appendExportPage,addExportLinks};`)(PDFLib, () => Promise.resolve(), createPdfColorManagement);
const directory = path.join(root, 'test-results/color-profiles');
fs.mkdirSync(directory, { recursive: true });
const frame = { id: 'color-frame', name: 'Color fixture', width: 600, height: 400 };
const results = [];
for (const profile of ['SRGB', 'DISPLAY_P3_V4']) for (const format of ['PDF', 'PNG', 'JPG']) {
  const input = fs.readFileSync(path.join(root, 'tests/fixtures/color-profiles', `swatches-${profile}.${format.toLowerCase()}`));
  const doc = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(doc, { frame, data: input, format, exportColorProfile: profile });
  const links = await addExportLinks(doc, [page], [frame], [{ fromFrameId: frame.id, type: 'external', source: 'prototype', toUrl: 'https://example.com/color', elementBounds: {x:300,y:240,width:300,height:160} }]);
  assert.equal(links.added, 1);
  const bytes = await doc.save();
  const name = `assembled-${profile}-${format}.pdf`;
  fs.writeFileSync(path.join(directory, name), bytes);
  const reloaded = await PDFLib.PDFDocument.load(bytes);
  assert.deepEqual(reloaded.getPage(0).getSize(), { width: 600, height: 400 });
  results.push({ profile, format, file: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), pages: 1, links: 1 });
}
fs.writeFileSync(path.join(directory, 'assembly-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ profile, format, bytes }) => ({ profile, format, bytes }))));
