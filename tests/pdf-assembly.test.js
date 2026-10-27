const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PDFLib = require('pdf-lib');

const root = path.resolve(__dirname, '..');
const sourcePath = fs.existsSync(path.join(root, 'src/ui.html')) ? 'src/ui.html' : 'ui.html';
const html = fs.readFileSync(path.join(root, sourcePath), 'utf8');
const helpers = html.slice(html.indexOf('// PDF_ASSEMBLY_START'), html.indexOf('// PDF_ASSEMBLY_END'));
const context = new Function('PDFLib', 'yieldToBrowser', `${helpers}\nreturn { appendExportPage, addExportLinks, nativeLinkRecords, normalizeUrl, calculateLinkBounds, appendLinkAnnotation };`)(PDFLib, () => Promise.resolve());
const { appendExportPage, addExportLinks, nativeLinkRecords, normalizeUrl, calculateLinkBounds } = context;
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/native-links.pdf'));
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const frame = { id: 'first', name: 'Native links', width: 600, height: 400 };
const textLinks = ['first', 'second', 'third'].map(name => ({
  fromFrameId: 'first', type: 'external', source: 'text', textNodeId: 'text1', needsTextGeometry: true,
  toUrl: `https://example.com/${name}`, elementBounds: { x: 40, y: 59, width: 280, height: 120 }
}));
const plainRecords = (doc, page) => JSON.parse(JSON.stringify(nativeLinkRecords(doc, page).map(({ target, rect }) => ({ target, rect }))));

test('native vector import preserves five exact Figma text rectangles without whole-node overlays', async () => {
  const source = await PDFLib.PDFDocument.load(fixture);
  const expected = plainRecords(source, source.getPage(0));
  assert.equal(expected.length, 5);
  assert.equal(expected.filter(record => record.target.endsWith('/third')).length, 3);
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: fixture });
  const result = await addExportLinks(output, [page], [frame], textLinks);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 0);
  const reloaded = await PDFLib.PDFDocument.load(await output.save());
  assert.deepEqual(plainRecords(reloaded, reloaded.getPage(0)), expected);
  assert.ok(expected[0].rect[2] < expected[1].rect[0], 'neighboring URLs keep separate clickable regions');
});

test('raster pages retain precise native text annotations without copying the native page contents', async () => {
  const source = await PDFLib.PDFDocument.load(fixture);
  const expected = plainRecords(source, source.getPage(0));
  const output = await PDFLib.PDFDocument.create();
  const { page, warnings } = await appendExportPage(output, { frame, format: 'PNG', data: png, annotationPdfData: fixture });
  assert.equal(warnings.length, 0);
  assert.deepEqual(page.getSize(), { width: 600, height: 400 });
  await addExportLinks(output, [page], [frame], textLinks);
  assert.deepEqual(plainRecords(output, page), expected);
  const saved = await output.save();
  assert.ok(saved.length < fixture.length / 2, 'only annotation geometry, not vector content, was copied');
});

test('missing partial-text geometry is reported instead of creating overlapping whole-node links', async () => {
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PNG', data: png });
  const result = await addExportLinks(output, [page], [frame], textLinks);
  assert.equal(result.skipped, 3);
  assert.equal(result.warnings.length, 1);
  assert.equal(plainRecords(output, page).length, 0);
});

async function internalFixture() {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([600, 400]);
  context.appendLinkAnnotation(doc, page, [40, 300, 190, 330], null, '');
  return doc.save();
}

async function nativeUriFixture(records) {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([600, 400]);
  for (const { rect, uri } of records) context.appendLinkAnnotation(doc, page, rect, null, uri);
  return doc.save();
}

test('desktop Figma NODE URLs become exact internal destinations for vector and raster pages', async () => {
  const uri = 'https://www.figma.com/design/yKf6bZSYBB3tZoWz5qMmen/PDF-Export-v9-%E2%80%94-Regression---Stress-Tests?node-id=1-2';
  const rect = [40, 210.977, 314.7898, 240.0227];
  const bytes = await nativeUriFixture([{ uri, rect }]);
  for (const format of ['PDF', 'PNG']) {
    const output = await PDFLib.PDFDocument.create();
    const { page } = await appendExportPage(output, { frame, format,
      data: format === 'PDF' ? bytes : png,
      annotationPdfData: format === 'PNG' ? bytes : undefined });
    const destination = output.addPage([400, 300]);
    const target = { id: 'target', width: 400, height: 300 };
    const link = { source: 'text', type: 'internal', fromFrameId: frame.id,
      toFrameId: target.id, toNodeId: '1:2', textNodeId: 'node1',
      elementBounds: { x: 40, y: 150, width: 300, height: 50 } };
    const result = await addExportLinks(output, [page, destination], [frame, target], [link]);
    assert.equal(result.added, 1, format);
    assert.equal(result.skipped, 0, format);
    const reloaded = await PDFLib.PDFDocument.load(await output.save());
    assert.deepEqual(plainRecords(reloaded, reloaded.getPage(0)), [
      { target: `page:${reloaded.getPage(1).ref}`, rect }
    ], format);
    assert.equal(nativeLinkRecords(output, page)[0].annotation.has(PDFLib.PDFName.of('A')), false,
      'the web action must be replaced, not kept alongside Dest');
  }
});

test('node IDs in Figma URLs disambiguate multiple destinations within one text node', async () => {
  const rects = [[40, 300, 150, 330], [170, 300, 280, 330]];
  const bytes = await nativeUriFixture([
    { uri: 'https://figma.com/file/abc123/Design?node-id=1%3A2', rect: rects[0] },
    { uri: 'https://www.figma.com/design/abc123/Design?node-id=9-10', rect: rects[1] }
  ]);
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: bytes });
  const pages = [page, output.addPage([400, 300]), output.addPage([400, 300])];
  const frames = [frame, { id: 'target1', width: 400, height: 300 }, { id: 'target2', width: 400, height: 300 }];
  const links = ['1:2', '9:10'].map((toNodeId, index) => ({ source: 'text', type: 'internal',
    fromFrameId: frame.id, toFrameId: frames[index + 1].id, toNodeId, textNodeId: 'shared-text',
    elementBounds: { x: 40, y: 70, width: 240, height: 35 } }));
  const result = await addExportLinks(output, pages, frames, links);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 0);
  assert.deepEqual(plainRecords(output, page), rects.map((rect, index) => ({ target: `page:${pages[index + 1].ref}`, rect })));
});

test('a Figma URL to a descendant maps to its exported ancestor frame', async () => {
  const rect = [40, 300, 190, 330];
  const bytes = await nativeUriFixture([{ uri: 'https://www.figma.com/design/abc123/Design?node-id=I9-10%3B1-2', rect }]);
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: bytes });
  const destination = output.addPage([400, 300]);
  const target = { id: '9:10', width: 400, height: 300 };
  const link = { source: 'text', type: 'internal', fromFrameId: frame.id,
    toFrameId: target.id, toNodeId: 'I9:10;1:2', textNodeId: 'node1',
    elementBounds: { x: 40, y: 70, width: 200, height: 35 } };
  const result = await addExportLinks(output, [page, destination], [frame, target], [link]);
  assert.equal(result.skipped, 0);
  assert.deepEqual(plainRecords(output, page), [{ target: `page:${destination.ref}`, rect }]);
});

test('unrelated domains, Figma routes, node IDs and text regions retain their web actions', async () => {
  const cases = [
    ['https://www.figma.com.evil.example/design/abc123/Design?node-id=1-2', [40, 300, 190, 330]],
    ['https://example.com/design/abc123/Design?node-id=1-2', [40, 300, 190, 330]],
    ['https://www.figma.com/proto/abc123/Design?node-id=1-2', [40, 300, 190, 330]],
    ['https://www.figma.com/design/?node-id=1-2', [40, 300, 190, 330]],
    ['https://www.figma.com/design/abc123/Design?node-id=2-4', [40, 300, 190, 330]],
    ['https://www.figma.com/design/abc123/Design?node-id=1-2&node-id=2-4', [40, 300, 190, 330]],
    ['https://www.figma.com/design/abc123/Design?node-id=1-2', [340, 300, 490, 330]]
  ];
  for (const [uri, rect] of cases) {
    const output = await PDFLib.PDFDocument.create();
    const { page } = await appendExportPage(output, { frame, format: 'PDF', data: await nativeUriFixture([{ uri, rect }]) });
    const destination = output.addPage([400, 300]);
    const target = { id: 'target', width: 400, height: 300 };
    const link = { source: 'text', type: 'internal', fromFrameId: frame.id,
      toFrameId: target.id, toNodeId: '1:2', textNodeId: 'node1',
      elementBounds: { x: 40, y: 70, width: 200, height: 35 } };
    const result = await addExportLinks(output, [page, destination], [frame, target], [link]);
    assert.equal(result.added, 0, uri);
    assert.deepEqual(plainRecords(output, page), [{ target: normalizeUrl(uri), rect }], uri);
  }
});

test('an explicitly external text URL in the same region is not converted into a page jump', async () => {
  const uri = 'https://www.figma.com/design/abc123/Design?node-id=1-2';
  const rect = [40, 300, 190, 330];
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: await nativeUriFixture([{ uri, rect }]) });
  const destination = output.addPage([400, 300]);
  const target = { id: 'target', width: 400, height: 300 };
  const common = { source: 'text', fromFrameId: frame.id, textNodeId: 'shared-text',
    elementBounds: { x: 40, y: 70, width: 200, height: 35 } };
  const result = await addExportLinks(output, [page, destination], [frame, target], [
    { ...common, type: 'internal', toFrameId: target.id, toNodeId: '1:2' },
    { ...common, type: 'external', toUrl: uri }
  ]);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1, 'the ambiguous internal range is reported instead of hijacking the web link');
  assert.deepEqual(plainRecords(output, page), [{ target: uri, rect }]);
});

test('empty native NODE URI becomes an exact internal destination in exported page order', async () => {
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: await internalFixture() });
  const destination = output.addPage([400, 300]);
  const targetFrame = { id: 'target', width: 400, height: 300 };
  const link = { source: 'text', type: 'internal', fromFrameId: frame.id, toFrameId: 'target', textNodeId: 'node1', elementBounds: { x: 40, y: 70, width: 200, height: 35 } };
  const result = await addExportLinks(output, [page, destination], [frame, targetFrame], [link]);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(plainRecords(output, page), [{ target: `page:${destination.ref}`, rect: [40, 300, 190, 330] }]);
});

test('multiple destinations within one text node are omitted rather than guessed', async () => {
  const output = await PDFLib.PDFDocument.create();
  const { page } = await appendExportPage(output, { frame, format: 'PDF', data: await internalFixture() });
  const pages = [page, output.addPage([400, 300]), output.addPage([400, 300])];
  const frames = [frame, { id: 'target1', width: 400, height: 300 }, { id: 'target2', width: 400, height: 300 }];
  const links = ['target1', 'target2'].map(toFrameId => ({ source: 'text', type: 'internal', fromFrameId: frame.id, toFrameId, textNodeId: 'node1', elementBounds: { x: 40, y: 70, width: 200, height: 35 } }));
  const result = await addExportLinks(output, pages, frames, links);
  assert.equal(result.skipped, 2);
  assert.equal(plainRecords(output, page).length, 0);
});

test('prototype links use exact clipped bounds and preserve safe URL schemes', async () => {
  const output = await PDFLib.PDFDocument.create();
  const page = output.addPage([600, 400]);
  const result = await addExportLinks(output, [page], [frame], [
    { fromFrameId: frame.id, source: 'prototype', type: 'external', toUrl: 'mailto:hello@example.com', elementBounds: { x: -5, y: 20, width: 10, height: 2 } },
    { fromFrameId: frame.id, source: 'prototype', type: 'external', toUrl: 'javascript:alert(1)', elementBounds: { x: 0, y: 0, width: 10, height: 10 } },
    { fromFrameId: frame.id, source: 'prototype', type: 'external', toUrl: 'https://example.com', elementBounds: { x: 700, y: 0, width: 10, height: 10 } }
  ]);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(plainRecords(output, page), [{ target: 'mailto:hello@example.com', rect: [0, 378, 5, 380] }]);
  assert.equal(normalizeUrl('tel:+48123456789'), 'tel:+48123456789');
  assert.equal(normalizeUrl('data:text/html,hello'), null);
  assert.equal(normalizeUrl('https://example.com/\nunsafe'), null);
  assert.equal(calculateLinkBounds({ x: 700, y: 1, width: 10, height: 10 }, 600, 400), null);
});

test('corrupt page data and unexpected PDF dimensions cannot create successful blank pages', async () => {
  const output = await PDFLib.PDFDocument.create();
  await assert.rejects(appendExportPage(output, { frame, format: 'PNG', data: Uint8Array.of(1, 2, 3) }));
  await assert.rejects(appendExportPage(output, { frame: { ...frame, width: 700 }, format: 'PDF', data: fixture }), /dimensions differ/);
  assert.equal(output.getPageCount(), 0);
});

test('offset native page boxes cannot silently shift text links on a raster fallback', async () => {
  const cases = [
    { label: 'offset MediaBox with inherited CropBox', media: [20, 30, 600, 400] },
    { label: 'offset CropBox', media: [0, 0, 600, 400], crop: [20, 30, 600, 400] },
    { label: 'offset MediaBox with explicit zero-origin CropBox', media: [20, 30, 600, 400], crop: [0, 0, 600, 400] }
  ];
  for (const geometry of cases) {
    const source = await PDFLib.PDFDocument.create();
    const sourcePage = source.addPage([600, 400]);
    sourcePage.setMediaBox(...geometry.media);
    if (geometry.crop) sourcePage.setCropBox(...geometry.crop);
    context.appendLinkAnnotation(source, sourcePage, [60, 330, 190, 360], null, 'https://example.com/link');
    const bytes = await source.save();
    const output = await PDFLib.PDFDocument.create();
    await assert.rejects(appendExportPage(output, { frame, format: 'PDF', data: bytes }), /dimensions differ/, geometry.label);
    assert.equal(output.getPageCount(), 0, geometry.label);
    const { page, warnings } = await appendExportPage(output, { frame, format: 'PNG', data: png, annotationPdfData: bytes });
    assert.equal(output.getPageCount(), 1, 'the raster page remains usable');
    assert.match(warnings.join(' '), /precise text-link geometry could not be imported/, geometry.label);
    assert.deepEqual(plainRecords(output, page), [], geometry.label);
    const result = await addExportLinks(output, [page], [frame], [{
      source: 'text', type: 'external', fromFrameId: frame.id, toUrl: 'https://example.com/link',
      elementBounds: { x: 40, y: 70, width: 150, height: 30 }
    }]);
    assert.equal(result.skipped, 1, 'missing precision is reported instead of creating a displaced link');
  }
});

test('many pages with duplicate names preserve count, ID mapping, and exact dimensions', async () => {
  const output = await PDFLib.PDFDocument.create();
  const pages = [], frames = [];
  for (let i = 0; i < 80; i++) {
    const item = { id: `frame-${i}`, name: 'Same name', width: 200 + i, height: 300 };
    const { page } = await appendExportPage(output, { frame: item, format: 'PNG', data: png });
    frames.push(item); pages.push(page);
  }
  await addExportLinks(output, pages, frames, [{ fromFrameId: 'frame-0', toFrameId: 'frame-79', type: 'internal', source: 'prototype', elementBounds: { x: 1, y: 2, width: 3, height: 4 } }]);
  const saved = await output.save();
  const reloaded = await PDFLib.PDFDocument.load(saved);
  assert.equal(reloaded.getPageCount(), 80);
  assert.equal(reloaded.getPage(79).getWidth(), 279);
  assert.equal(plainRecords(output, pages[0])[0].target, `page:${pages[79].ref}`);
});
