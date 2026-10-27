const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('pdf-lib');
const jpeg = require('jpeg-js');
const { createPdfImageResampler } = require('../src/pdf-image-resolution');
const { createPdfColorManagement } = require('../src/color-profiles');
const n = P.PDFName.of;
const decoded = stream => new Uint8Array(P.decodePDFRawStream(stream).decode());
const resampler = options => createPdfImageResampler(P, { yieldToBrowser: () => Promise.resolve(), ...options });

function addImage(doc, width = 8, height = 8, options = {}) {
  const { samples = new Uint8Array(width * height * 3).fill(120), compressed = true, ...dictionary } = options;
  const metadata = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', ...dictionary };
  const stream = compressed ? doc.context.flateStream(samples, metadata) : doc.context.stream(samples, metadata);
  return { ref: doc.context.register(stream), stream };
}

function setContent(doc, page, instructions, resources = {}) {
  page.node.set(n('Resources'), doc.context.obj(resources));
  const parts = Array.isArray(instructions) ? instructions : [instructions];
  const refs = parts.map(part => doc.context.register(doc.context.flateStream(part)));
  page.node.set(n('Contents'), doc.context.obj(refs));
  return refs.map(ref => doc.context.lookup(ref));
}

function imageSize(doc, ref) {
  const image = doc.context.lookup(ref);
  return [image.dict.lookup(n('Width')).asNumber(), image.dict.lookup(n('Height')).asNumber()];
}

async function setup(width = 8, height = 8, options = {}) {
  const doc = await P.PDFDocument.create(), page = doc.addPage([720, 720]);
  const image = addImage(doc, width, height, options);
  const streams = setContent(doc, page, `q\n4 0 0 4 0 0 cm\n/I Do\nQ\n`, { XObject: { I: image.ref } });
  return { doc, page, image, streams };
}

test('raw and Flate samples are area-averaged without touching content, vectors, text or links', async () => {
  for (const compressed of [false, true]) {
    const samples = Uint8Array.from({ length: 4 * 4 * 3 }, (_, i) => Math.floor(i / 3) * 10 + i % 3);
    const { doc, page, image } = await setup(4, 4, { samples, compressed });
    const content = 'q 4 0 0 4 0 0 cm /I Do Q\n0 0 10 10 re f\nBT /F1 12 Tf (Keep text) Tj ET\n';
    const font = await doc.embedFont(P.StandardFonts.Helvetica);
    const [stream] = setContent(doc, page, content, { XObject: { I: image.ref }, Font: { F1: font.ref } });
    const annotation = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [2, 3, 40, 50], A: { S: 'URI', URI: P.PDFString.of('https://example.com/a') } });
    const annotationRef = doc.context.register(annotation);
    page.node.set(n('Annots'), doc.context.obj([annotationRef]));
    const before = stream.contents.slice(), annotationBefore = annotation.toString();
    const result = await resampler().resamplePage(doc, page, { dpi: 36 });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.stats.imagesResampled, 1);
    assert.deepEqual(imageSize(doc, image.ref), [2, 2]);
    assert.deepEqual(Array.from(decoded(doc.context.lookup(image.ref))), [25, 26, 27, 45, 46, 47, 105, 106, 107, 125, 126, 127]);
    assert.deepEqual(stream.contents, before);
    assert.equal(annotation.toString(), annotationBefore);
    const reloaded = await P.PDFDocument.load(await doc.save());
    assert.equal(reloaded.getPageCount(), 1);
    assert.equal(reloaded.getPage(0).node.lookup(n('Annots')).size(), 1);
  }
});

test('all seven UI DPI settings produce the expected dimensions on a 720-point page', async () => {
  // A real 3000 x 3000 sample plane: 300 native DPI at 720 x 720 points.
  // Testing actual output bytes catches no-op implementations of the selector.
  const samples = new Uint8Array(3000 * 3000).fill(137);
  for (const dpi of [36, 72, 108, 144, 216, 288, 300]) {
    const { doc, page, image } = await setup(3000, 3000, { samples, ColorSpace: 'DeviceGray' });
    const font = await doc.embedFont(P.StandardFonts.Helvetica);
    const [stream] = setContent(doc, page, 'q 720 0 0 720 0 0 cm /I Do Q\n3 4 50 60 re S\nBT /F 12 Tf (Native text) Tj ET\n', { XObject: { I: image.ref }, Font: { F: font.ref } });
    const annots = doc.context.obj([{ Subtype: 'Link', Rect: [3, 4, 53, 64], A: { S: 'URI', URI: P.PDFString.of('https://example.com') } }]);
    page.node.set(n('Annots'), annots);
    const originalContent = stream.contents.slice(), originalAnnots = annots.toString();
    const result = await resampler().resamplePage(doc, page, { dpi });
    assert.deepEqual(result.warnings, [], `DPI ${dpi}`);
    assert.deepEqual(imageSize(doc, image.ref), [dpi * 10, dpi * 10], `DPI ${dpi}`);
    assert.deepEqual(stream.contents, originalContent);
    assert.equal(annots.toString(), originalAnnots);
    assert.equal(decoded(doc.context.lookup(image.ref)).length, dpi * dpi * 100);
    if (dpi === 300) assert.equal(doc.context.lookup(image.ref), image.stream, 'native resolution must remain byte-identical');
  }
});

test('requests above native density never upsample or reencode', async () => {
  const { doc, page, image } = await setup();
  const objects = doc.context.enumerateIndirectObjects().length;
  const result = await resampler().resamplePage(doc, page, { dpi: 300 });
  assert.equal(result.stats.imagesResampled, 0);
  assert.equal(doc.context.lookup(image.ref), image.stream);
  assert.equal(doc.context.enumerateIndirectObjects().length, objects);
});

test('rotation, shear, UserUnit and shared placements determine conservative dimensions', async () => {
  for (const [matrix, unit, expected] of [
    ['4 0 0 4', 1, 4], ['0 4 -4 0', 1, 4], ['4 0 4 4', 1, 7], ['2 0 0 2', 2, 4],
  ]) {
    const { doc, page, image } = await setup();
    page.node.set(n('UserUnit'), P.PDFNumber.of(unit));
    setContent(doc, page, `q ${matrix} 0 0 cm /I Do Q`, { XObject: { I: image.ref } });
    const result = await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(imageSize(doc, image.ref), [expected, expected]);
  }
  for (const sizes of [[2, 6], [6, 2]]) {
    const { doc, page, image } = await setup();
    setContent(doc, page, sizes.map(size => `q ${size} 0 0 ${size} 0 0 cm /I Do Q`).join('\n'), { XObject: { I: image.ref } });
    await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.deepEqual(imageSize(doc, image.ref), [6, 6]);
  }
});

test('nested Forms compose matrices and retain shared image density across all uses', async () => {
  const { doc, page, image } = await setup();
  const inner = doc.context.register(doc.context.flateStream('2 0 0 2 0 0 cm /I Do', { Subtype: 'Form', BBox: [0, 0, 10, 10], Matrix: [0, 1, -1, 0, 0, 0], Resources: { XObject: { I: image.ref } } }));
  const outer = doc.context.register(doc.context.flateStream('/Inner Do', { Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: { XObject: { Inner: inner } } }));
  setContent(doc, page, 'q 2 0 0 2 0 0 cm /Outer Do Q\nq 3 0 0 3 0 0 cm /Outer Do Q', { XObject: { Outer: outer } });
  const innerBefore = doc.context.lookup(inner).contents.slice();
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(imageSize(doc, image.ref), [6, 6]);
  assert.deepEqual(doc.context.lookup(inner).contents, innerBefore);
});

test('inherited Form resources and q/Q state across content streams work', async () => {
  const { doc, page, image } = await setup();
  const form = doc.context.register(doc.context.flateStream('/I Do', { Subtype: 'Form', BBox: [0, 0, 1, 1], Matrix: [2, 0, 0, 2, 0, 0] }));
  setContent(doc, page, ['q 2 0 0 2 0 0 cm', '/Fm Do Q'], { XObject: { I: image.ref, Fm: form } });
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(imageSize(doc, image.ref), [4, 4]);
});

test('sRGB and Display P3 ICC bytes and color-space references remain exact', async () => {
  for (const profileName of ['SRGB', 'DISPLAY_P3_V4']) {
    const { doc, page, image } = await setup();
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/color-profiles', `native-${profileName}.png`)));
    const profile = createPdfColorManagement(P).getRasterProfile(doc, bytes, 'PNG', profileName).profile;
    const profileRef = doc.context.register(doc.context.flateStream(profile, { N: 3 }));
    const colorSpace = doc.context.obj(['ICCBased', profileRef]);
    image.stream.dict.set(n('ColorSpace'), colorSpace);
    const result = await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.deepEqual(result.warnings, []);
    assert.equal(doc.context.lookup(image.ref).dict.get(n('ColorSpace')), colorSpace);
    assert.deepEqual(decoded(doc.context.lookup(profileRef)), profile);
    assert.deepEqual(Array.from(decoded(doc.context.lookup(image.ref))), new Array(4 * 4 * 3).fill(120));
  }
});

test('JPEG downsampling uses source decoded channels without browser color conversion', async () => {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) rgba.set([i * 3, 40 + i, 220 - i * 2, 255], i * 4);
  const encoded = new Uint8Array(jpeg.encode({ width: 8, height: 8, data: rgba }, 95).data);
  const reference = jpeg.decode(encoded, { useTArray: true, formatAsRGBA: false }).data;
  const expected = [];
  for (let y = 0; y < 8; y += 2) for (let x = 0; x < 8; x += 2) for (let c = 0; c < 3; c++) {
    const offsets = [y * 8 + x, y * 8 + x + 1, (y + 1) * 8 + x, (y + 1) * 8 + x + 1];
    expected.push(Math.round(offsets.reduce((sum, offset) => sum + reference[offset * 3 + c], 0) / 4));
  }
  const { doc, page, image } = await setup(8, 8, { samples: encoded, compressed: false, Filter: 'DCTDecode' });
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(Array.from(decoded(doc.context.lookup(image.ref))), expected);
});

test('soft-mask samples are resized with premultiplied color without changing a shared original mask', async () => {
  const { doc, page, image } = await setup(2, 2, { samples: Uint8Array.from([255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]) });
  const mask = addImage(doc, 2, 2, { samples: Uint8Array.from([255, 0, 255, 0]), ColorSpace: 'DeviceGray' });
  image.stream.dict.set(n('SMask'), mask.ref);
  setContent(doc, page, 'q 1 0 0 1 0 0 cm /I Do Q', { XObject: { I: image.ref } });
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.deepEqual(result.warnings, []);
  const resized = doc.context.lookup(image.ref), newMask = resized.dict.lookup(n('SMask'));
  assert.deepEqual(Array.from(decoded(resized)), [255, 0, 0]);
  assert.deepEqual(Array.from(decoded(newMask)), [128]);
  assert.equal(newMask.dict.lookup(n('Width')).asNumber(), 1);
  assert.equal(doc.context.lookup(mask.ref), mask.stream);
  assert.deepEqual(Array.from(decoded(mask.stream)), [255, 0, 255, 0]);
});

test('Alpha and Luminosity mask graphs protect their images but permit unrelated ordinary Flate images', async () => {
  for (const maskType of ['Alpha', 'Luminosity']) {
    const { doc, page, image } = await setup();
    const maskImage = addImage(doc);
    const group = doc.context.register(doc.context.flateStream('4 0 0 4 0 0 cm /MaskImage Do', { Subtype: 'Form', BBox: [0, 0, 4, 4], Resources: { XObject: { MaskImage: maskImage.ref } }, Group: { S: 'Transparency', CS: 'DeviceRGB' } }));
    const state = { SMask: { S: maskType, G: group } };
    setContent(doc, page, '/GS gs\nq 4 0 0 4 0 0 cm /I Do /MI Do Q', { XObject: { I: image.ref, MI: maskImage.ref }, ExtGState: { GS: state } });
    const originalGroup = doc.context.lookup(group).contents.slice();
    const result = await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.equal(result.stats.imagesResampled, 1);
    assert.deepEqual(imageSize(doc, image.ref), [4, 4]);
    assert.equal(doc.context.lookup(maskImage.ref), maskImage.stream);
    assert.deepEqual(doc.context.lookup(group).contents, originalGroup);
    assert(result.warnings.some(warning => /transparency mask/.test(warning)));
  }
});

test('tiling pattern images remain unchanged while unrelated visible images are resized', async () => {
  const { doc, page, image } = await setup();
  const patternImage = addImage(doc);
  const pattern = doc.context.register(doc.context.flateStream('/PImage Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 1, 1], XStep: 1, YStep: 1, Resources: { XObject: { PImage: patternImage.ref } } }));
  setContent(doc, page, '/Pattern cs /P scn 0 0 10 10 re f\nq 4 0 0 4 0 0 cm /I Do /PI Do Q', { XObject: { I: image.ref, PI: patternImage.ref }, Pattern: { P: pattern } });
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.equal(result.stats.imagesResampled, 1);
  assert.deepEqual(imageSize(doc, image.ref), [4, 4]);
  assert.equal(doc.context.lookup(patternImage.ref), patternImage.stream);
});

test('unsupported images are byte-identical and do not prevent supported sibling resampling', async () => {
  for (const properties of [
    { ColorSpace: 'DeviceCMYK' }, { BitsPerComponent: 16 }, { Decode: [1, 0, 1, 0, 1, 0] },
    { DecodeParms: { Predictor: 12 } }, { Mask: [0, 0, 0, 0, 0, 0] }, { SMaskInData: 1 },
  ]) {
    const { doc, page, image } = await setup();
    const unsupported = addImage(doc, 8, 8, properties);
    setContent(doc, page, 'q 4 0 0 4 0 0 cm /Bad Do /Good Do Q', { XObject: { Bad: unsupported.ref, Good: image.ref } });
    const result = await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.equal(result.stats.imagesResampled, 1, JSON.stringify(properties));
    assert.equal(result.stats.imagesUnchanged, 1);
    assert.equal(doc.context.lookup(unsupported.ref), unsupported.stream);
    assert.equal(result.warnings.length, 1);
  }
});

test('inline images and recursive Forms leave the complete page unchanged', async () => {
  for (const kind of ['inline', 'recursive']) {
    const { doc, page, image } = await setup();
    let instructions = 'q 4 0 0 4 0 0 cm /I Do Q\nBI /W 1 /H 1 ID x EI';
    const resources = { XObject: { I: image.ref } };
    if (kind === 'recursive') {
      const form = doc.context.register(doc.context.flateStream('/F Do', { Subtype: 'Form', BBox: [0, 0, 1, 1] }));
      resources.XObject.F = form;
      instructions = 'q 4 0 0 4 0 0 cm /I Do Q\n/F Do';
    }
    setContent(doc, page, instructions, resources);
    const result = await resampler().resamplePage(doc, page, { dpi: 72 });
    assert.equal(result.stats.pageUnchanged, true);
    assert.equal(doc.context.lookup(image.ref), image.stream);
    assert.equal(result.warnings.length, 1);
  }
});

test('invalid or oversized data is rejected before unbounded allocation', async () => {
  let jpegCalls = 0;
  const { doc, page, image } = await setup(4001, 5000, { samples: Uint8Array.of(1), compressed: false, Filter: 'DCTDecode' });
  const result = await resampler({ decodeJpeg: () => { jpegCalls++; throw new Error('must not decode'); } }).resamplePage(doc, page, { dpi: 36 });
  assert.equal(jpegCalls, 0);
  assert.equal(doc.context.lookup(image.ref), image.stream);
  assert(result.warnings.some(warning => /20 million/.test(warning)));
  const small = await setup(2, 2, { samples: new Uint8Array(100000), ColorSpace: 'DeviceGray' });
  setContent(small.doc, small.page, '1 0 0 1 0 0 cm /I Do', { XObject: { I: small.image.ref } });
  const bomb = await resampler().resamplePage(small.doc, small.page, { dpi: 72 });
  assert(bomb.warnings.some(warning => /decoded data exceeds/.test(warning)));
  assert.equal(small.doc.context.lookup(small.image.ref), small.image.stream);
});

test('four 4096-square sources fit the sequential work budget; a fifth is preserved with a warning', async () => {
  const doc = await P.PDFDocument.create(), page = doc.addPage([720, 720]);
  const samples = new Uint8Array(4096 * 4096).fill(83), images = [], objects = {};
  for (let i = 0; i < 5; i++) { images.push(addImage(doc, 4096, 4096, { samples, ColorSpace: 'DeviceGray' })); objects[`I${i}`] = images[i].ref; }
  setContent(doc, page, 'q 40 0 0 40 0 0 cm /I0 Do /I1 Do /I2 Do /I3 Do /I4 Do Q', { XObject: objects });
  const result = await resampler().resamplePage(doc, page, { dpi: 72 });
  assert.equal(result.stats.imagesResampled, 4);
  assert.equal(result.stats.decodedPixels, 4096 * 4096 * 4);
  for (const image of images.slice(0, 4)) {
    assert.deepEqual(imageSize(doc, image.ref), [40, 40]);
    assert.deepEqual(Array.from(decoded(doc.context.lookup(image.ref))), new Array(40 * 40).fill(83));
  }
  assert.equal(doc.context.lookup(images[4].ref), images[4].stream);
  assert(result.warnings.some(warning => /80 million/.test(warning)));
});

test('downsampling output above 16MP is rejected before decoding the source', async () => {
  const { doc, page, image } = await setup(4400, 4400, { samples: Uint8Array.of(1), compressed: false, Filter: 'DCTDecode' });
  setContent(doc, page, '4200 0 0 4200 0 0 cm /I Do', { XObject: { I: image.ref } });
  let called = false;
  const result = await resampler({ decodeJpeg: () => { called = true; } }).resamplePage(doc, page, { dpi: 72 });
  assert.equal(called, false);
  assert.equal(doc.context.lookup(image.ref), image.stream);
  assert(result.warnings.some(warning => /resized images above 16 million/.test(warning)));
});

test('cancellation after a staged image leaves every PDF object unchanged', async () => {
  const { doc, page, image } = await setup();
  const second = addImage(doc);
  setContent(doc, page, '4 0 0 4 0 0 cm /A Do /B Do', { XObject: { A: image.ref, B: second.ref } });
  const objectsBefore = doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref.toString(), object]);
  let active = true, yields = 0;
  await assert.rejects(resampler({ yieldToBrowser: async () => { if (++yields === 1) active = false; } }).resamplePage(doc, page, { dpi: 72, stillActive: () => active }), /cancelled/);
  assert.deepEqual(doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref.toString(), object]), objectsBefore);
  assert.equal(doc.context.lookup(image.ref), image.stream);
  assert.equal(doc.context.lookup(second.ref), second.stream);
});

test('cancellation during filtering also performs no mutations', async () => {
  const { doc, page, image } = await setup(1024, 1024);
  setContent(doc, page, '512 0 0 512 0 0 cm /I Do', { XObject: { I: image.ref } });
  let active = true;
  await assert.rejects(resampler({ yieldToBrowser: async () => { active = false; } }).resamplePage(doc, page, { dpi: 72, stillActive: () => active }), /cancelled/);
  assert.equal(doc.context.lookup(image.ref), image.stream);
});

test('native Figma text and exact URI annotation fixture remains unchanged', async () => {
  const doc = await P.PDFDocument.load(fs.readFileSync(path.join(__dirname, 'fixtures/native-links.pdf')));
  const page = doc.getPage(0), contents = page.node.Contents();
  const refs = contents instanceof P.PDFArray ? contents.asArray() : [contents];
  const before = refs.map(ref => doc.context.lookup(ref).contents.slice());
  const annotationBefore = page.node.lookup(n('Annots')).toString();
  const result = await resampler().resamplePage(doc, page, { dpi: 36 });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.imagesResampled, 0);
  assert.deepEqual(refs.map(ref => doc.context.lookup(ref).contents), before);
  assert.equal(page.node.lookup(n('Annots')).toString(), annotationBefore);
});

test('invalid DPI fails explicitly before touching the document', async () => {
  const { doc, page, image } = await setup();
  for (const dpi of [undefined, 0, 35, 301, Infinity, '72']) await assert.rejects(resampler().resamplePage(doc, page, { dpi }), /36 and 300/);
  assert.equal(doc.context.lookup(image.ref), image.stream);
});
