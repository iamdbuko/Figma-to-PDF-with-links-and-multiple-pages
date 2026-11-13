const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('pdf-lib');
const { createPdfResourcePruner } = require('../src/pdf-resource-pruning');
const n = P.PDFName.of;
const pruner = options => createPdfResourcePruner(P, { yieldToBrowser: () => Promise.resolve(), ...options });

function image(doc, width = 2, height = 2, compressed = true) {
  const meta = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' };
  const data = new Uint8Array(width * height * 3).fill(120);
  return doc.context.register(compressed ? doc.context.flateStream(data, meta) : doc.context.stream(data, meta));
}
function content(doc, page, text) { page.node.set(n('Contents'), doc.context.register(doc.context.flateStream(text))); }
function form(doc, text, resources, extra = {}) {
  return doc.context.register(doc.context.flateStream(text, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], ...(resources ? { Resources: resources } : {}), ...extra }));
}
async function base() {
  const doc = await P.PDFDocument.create(), page = doc.addPage([100, 100]), used = image(doc), unused = image(doc);
  const objects = doc.context.obj({ Used: used, Unused: unused }), resources = doc.context.obj({ XObject: objects });
  page.node.set(n('Resources'), resources); content(doc, page, 'q 50 0 0 50 0 0 cm /Used Do Q');
  return { doc, page, used, unused, objects, resources };
}
const keys = res => res.lookup(n('XObject')).keys().map(key => key.decodeText()).sort();
const decoded = (doc, page) => Buffer.from(P.decodePDFRawStream(page.node.lookup(n('Contents'))).decode());

test('unused XObjects are excluded from copy while native drawing, links and source objects survive', async () => {
  const { doc, page, unused, objects, resources } = await base();
  const annotation = doc.context.obj({ Subtype: 'Link', Rect: [1, 2, 30, 40], A: { S: 'URI', URI: P.PDFString.of('https://example.com') } });
  page.node.set(n('Annots'), doc.context.obj([annotation]));
  const commands = decoded(doc, page), annotations = page.node.get(n('Annots')).toString(), originalObject = doc.context.lookup(unused);
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.equal(result.stats.removedEntries, 1);
  assert.equal(result.stats.removedEncodedBytes, originalObject.contents.length);
  assert.deepEqual(keys(resources), ['Used']);
  assert.deepEqual(objects.keys().map(String).sort(), ['/Unused', '/Used'], 'the original XObject dictionary is not mutated');
  assert.equal(doc.context.lookup(unused), originalObject, 'no indirect objects are deleted globally');
  assert.deepEqual(decoded(doc, page), commands); assert.equal(page.node.get(n('Annots')).toString(), annotations);
  const out = await P.PDFDocument.create(); out.addPage((await out.copyPages(doc, [0]))[0]);
  const reloaded = await P.PDFDocument.load(await out.save());
  assert.deepEqual(keys(reloaded.getPage(0).node.Resources()), ['Used']);
  assert.deepEqual(reloaded.getPage(0).getSize(), { width: 100, height: 100 });
  assert.equal(reloaded.getPage(0).node.lookup(n('Annots')).lookup(0).lookup(n('A')).lookup(n('URI')).decodeText(), 'https://example.com');
});

test('shared and indirect XObject maps retain the union of page and inherited Form uses', async () => {
  const { doc, page, resources, objects } = await base();
  const nested = form(doc, '/Unused Do'); objects.set(n('Form'), nested);
  const indirect = doc.context.register(objects); resources.set(n('XObject'), indirect);
  content(doc, page, '/Used Do /Form Do');
  const result = await pruner().prunePage(doc, page);
  assert.equal(result.stats.removedEntries, 0); assert.deepEqual(keys(resources), ['Form', 'Unused', 'Used']);
});

test('the same Form interpreted with different inherited resources retains each context', async () => {
  const { doc, page, resources, objects } = await base();
  const inner = form(doc, '/I Do');
  const a = doc.context.obj({ XObject: { I: image(doc), Inner: inner, Dead: image(doc) } });
  const b = doc.context.obj({ XObject: { I: image(doc), Inner: inner, Dead: image(doc) } });
  objects.set(n('A'), form(doc, '/Inner Do', a)); objects.set(n('B'), form(doc, '/Inner Do', b));
  content(doc, page, '/A Do /B Do');
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['A', 'B']);
  assert.deepEqual(keys(a), ['I', 'Inner']); assert.deepEqual(keys(b), ['I', 'Inner']);
  assert.equal(result.stats.removedEntries, 4);
});

for (const kind of ['Alpha', 'Luminosity']) test(`${kind} soft-mask drawing retains needed images without keeping unrelated resource entries`, async () => {
  const { doc, page, resources, objects } = await base();
  objects.set(n('MaskImage'), image(doc));
  const group = form(doc, '/MaskImage Do', resources, { Group: { S: 'Transparency', CS: 'DeviceRGB' } });
  resources.set(n('ExtGState'), doc.context.obj({ GS: { SMask: { S: kind, G: group } } }));
  content(doc, page, '/GS gs /Used Do');
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['MaskImage', 'Used']);
});

test('path-only mask sharing page resources does not preserve an unused image', async () => {
  const { doc, page, resources } = await base();
  const group = form(doc, '1 g 0 0 100 100 re f', resources, { Group: { S: 'Transparency', CS: 'DeviceGray' } });
  resources.set(n('ExtGState'), doc.context.obj({ GS: { SMask: { S: 'Alpha', G: group } } }));
  content(doc, page, '/GS gs /Used Do');
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['Used']);
});

test('tiling pattern images and shading-pattern soft-mask images survive', async () => {
  const { doc, page, resources, objects } = await base();
  objects.set(n('TileImage'), image(doc)); objects.set(n('ShadeMask'), image(doc));
  const tile = form(doc, '/TileImage Do', resources, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, XStep: 100, YStep: 100 });
  const mask = form(doc, '/ShadeMask Do', resources, { Group: { S: 'Transparency', CS: 'DeviceRGB' } });
  resources.set(n('Pattern'), doc.context.obj({ Tile: tile, Shade: { Type: 'Pattern', PatternType: 2, Shading: { ShadingType: 2 }, ExtGState: { SMask: { S: 'Alpha', G: mask } } } }));
  content(doc, page, '/Pattern cs /Tile scn 0 0 100 100 re f /Shade scn 0 0 100 100 re f');
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['ShadeMask', 'TileImage']);
});

test('every painted Type3 glyph is analyzed, including glyphs not decoded from the text string', async () => {
  const { doc, page, resources, objects } = await base();
  objects.set(n('GlyphImage'), image(doc)); objects.set(n('OtherGlyph'), image(doc));
  resources.set(n('Font'), doc.context.obj({ F: { Type: 'Font', Subtype: 'Type3', Resources: resources, CharProcs: { A: doc.context.register(doc.context.flateStream('0 0 d0 /GlyphImage Do')), B: doc.context.register(doc.context.flateStream('0 0 d0 /OtherGlyph Do')) } } }));
  content(doc, page, 'BT /F 12 Tf (A) Tj ET');
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['GlyphImage', 'OtherGlyph']);
});

test('normal, rollover, down and named annotation appearance images remain available', async () => {
  const { doc, page, resources, objects } = await base();
  for (const key of ['Normal', 'Over', 'Down']) objects.set(n(key), image(doc));
  page.node.set(n('Annots'), doc.context.obj([{ Subtype: 'Widget', Rect: [0, 0, 10, 10], AP: { N: { On: form(doc, '/Normal Do') }, R: form(doc, '/Over Do'), D: form(doc, '/Down Do') } }]));
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.deepEqual(keys(resources), ['Down', 'Normal', 'Over', 'Used']);
});

test('custom image or page metadata referencing resources preserves the opaque subtree', async () => {
  for (const location of ['image', 'page']) {
    const { doc, page, resources, used } = await base();
    (location === 'image' ? doc.context.lookup(used).dict : page.node).set(n('CustomData'), resources);
    const result = await pruner().prunePage(doc, page);
    assert.deepEqual(result.warnings, []); assert.equal(result.stats.removedEntries, 0);
    assert.deepEqual(keys(resources), ['Unused', 'Used']);
  }
});

test('blank pages and inherited page Resources are counted and pruned', async () => {
  const { doc, page, resources } = await base();
  const parent = doc.context.lookup(page.node.get(n('Parent')));
  parent.set(n('Resources'), resources); page.node.delete(n('Resources')); page.node.delete(n('Contents'));
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []); assert.equal(result.stats.removedEntries, 2);
  assert(result.stats.removedEncodedBytes > 0); assert.deepEqual(keys(resources), []);
});

for (const scenario of ['inline', 'unknown', 'predictor', 'recursive', 'annotation', 'multisource']) test(`unsupported ${scenario} keeps the entire resource graph unchanged`, async () => {
  const { doc, page, resources, objects } = await base();
  if (scenario === 'inline') content(doc, page, 'BI /W 1 /H 1 ID x EI');
  if (scenario === 'unknown') content(doc, page, '/Used Do /Unused UnknownPaint');
  if (scenario === 'predictor') page.node.lookup(n('Contents')).dict.set(n('DecodeParms'), doc.context.obj({ Predictor: 12 }));
  if (scenario === 'recursive') { objects.set(n('Loop'), form(doc, '/Loop Do')); content(doc, page, '/Loop Do'); }
  if (scenario === 'annotation') page.node.set(n('Annots'), doc.context.obj([{ AP: { N: { Broken: n('Unknown') } } }]));
  if (scenario === 'multisource') doc.addPage([100, 100]).node.set(n('Resources'), resources);
  const before = resources.toString(), result = await pruner().prunePage(doc, page);
  assert.equal(result.stats.skipped, true); assert.equal(result.stats.removedEntries, 0);
  assert.equal(result.warnings.length, 1); assert.equal(resources.toString(), before);
});

test('cancellation during content traversal leaves resources unchanged', async () => {
  const { doc, page, resources } = await base(); content(doc, page, '0 g\n'.repeat(9000) + '/Used Do');
  let running = true;
  await assert.rejects(pruner({ yieldToBrowser: async () => { running = false; } }).prunePage(doc, page, { stillActive: () => running }), /cancelled/);
  assert.deepEqual(keys(resources), ['Unused', 'Used']);
});

test('15 pages with an unused9MiB image exceed the real128MiB guard before pruning and retain tiny exact pages afterward', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/ui.html'), 'utf8');
  const budgetSource = html.slice(html.indexOf('const PDF_DOCUMENT_LIMIT ='), html.indexOf('function createOutputPlan('));
  const { assertPdfBudget, estimatePdfBytes } = new Function(budgetSource + ';return { assertPdfBudget, estimatePdfBytes };')();
  const { doc, page, resources } = await base();
  resources.lookup(n('XObject')).set(n('Unused'), image(doc, 2048, 1536, false));
  const before = await P.PDFDocument.create();
  for (let i = 0; i < 15; i++) before.addPage((await before.copyPages(doc, [0]))[0]);
  assert(estimatePdfBytes(before) > 128 * 1024 * 1024); assert.throws(() => assertPdfBudget(before), /retained-data allowance/);
  const result = await pruner().prunePage(doc, page);
  assert.equal(result.stats.removedEncodedBytes, 9 * 1024 * 1024);
  const after = await P.PDFDocument.create();
  for (let i = 0; i < 15; i++) after.addPage((await after.copyPages(doc, [0]))[0]);
  assert(assertPdfBudget(after) < 32 * 1024);
  const saved = await after.save(); assert(saved.length < 16 * 1024);
  const reloaded = await P.PDFDocument.load(saved);
  assert.equal(reloaded.getPageCount(), 15);
  for (const output of reloaded.getPages()) { assert.deepEqual(output.getSize(), { width: 100, height: 100 }); assert.deepEqual(keys(output.node.Resources()), ['Used']); }
});

test('existing native Figma fixture links, page geometry and drawing bytes survive save and reload', async () => {
  const file = path.join(__dirname, 'fixtures/native-links.pdf'), doc = await P.PDFDocument.load(fs.readFileSync(file)), page = doc.getPage(0);
  const before = page.node.lookup(n('Annots')).toString(), commands = decoded(doc, page), geometry = page.getSize();
  const result = await pruner().prunePage(doc, page);
  assert.deepEqual(result.warnings, []);
  assert.equal(page.node.lookup(n('Annots')).toString(), before); assert.deepEqual(decoded(doc, page), commands);
  const out = await P.PDFDocument.create(); out.addPage((await out.copyPages(doc, [0]))[0]);
  const reloaded = await P.PDFDocument.load(await out.save()); assert.deepEqual(reloaded.getPage(0).getSize(), geometry);
  assert.equal(reloaded.getPage(0).node.lookup(n('Annots')).size(), 5);
});
