const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('pdf-lib');
const jpeg = require('jpeg-js');
const { createCmykExporter } = require('../src/cmyk');
const { createPdfColorManagement } = require('../src/color-profiles');
const { createVectorCmykConverter } = require('../src/vector-cmyk');

const fixtures = path.join(__dirname, 'fixtures');
const read = name => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const printer = () => read('color-profiles/synthetic-cmyk-test-only.icc');
const name = P.PDFName.of;
const decoded = stream => new Uint8Array(P.decodePDFRawStream(stream).decode());
let constants, lcms;
test.before(async () => {
  constants = await import('lcms-wasm');
  lcms = await constants.instantiate({ wasmBinary: new Uint8Array(fs.readFileSync(require.resolve('lcms-wasm/dist/lcms.wasm'))) });
});
const exporter = options => createCmykExporter(P, {
  loadEngine: async () => ({ lcms, constants }), yieldToBrowser: () => Promise.resolve(), ...options,
});
const converter = () => createVectorCmykConverter(P);

// This reference opens its own profiles and creates a separate LittleCMS
// transform. It never calls the session's conversion methods or PDF converter.
function reference(source, destination, rgb, bits = 16) {
  const pointers = [], profiles = [];
  let transform;
  const allocate = size => { const pointer = lcms._malloc(size); assert(pointer); pointers.push(pointer); return pointer; };
  const open = bytes => {
    const pointer = allocate(bytes.length); lcms.HEAPU8.set(bytes, pointer);
    const profile = lcms._cmsOpenProfileFromMem(pointer, bytes.length); assert(profile); profiles.push(profile); return profile;
  };
  try {
    transform = lcms.cmsCreateTransform(open(source), bits === 16 ? constants.TYPE_RGB_16 : constants.TYPE_RGB_8,
      open(destination), bits === 16 ? constants.TYPE_CMYK_16 : constants.TYPE_CMYK_8,
      constants.INTENT_RELATIVE_COLORIMETRIC, constants.cmsFLAGS_BLACKPOINTCOMPENSATION | constants.cmsFLAGS_NOCACHE);
    assert(transform);
    const pixels = rgb.length / 3, input = allocate(rgb.length * bits / 8), output = allocate(pixels * 4 * bits / 8);
    if (bits === 16) new Uint16Array(lcms.HEAPU8.buffer, input, rgb.length).set(Array.from(rgb, v => Math.round(v * 65535)));
    else lcms.HEAPU8.set(rgb, input);
    lcms._cmsDoTransform(transform, input, output, pixels);
    return bits === 16 ? new Uint16Array(lcms.HEAPU8.buffer, output, pixels * 4).slice()
      : lcms.HEAPU8.slice(output, output + pixels * 4);
  } finally {
    if (transform) lcms.cmsDeleteTransform(transform);
    for (const profile of profiles) lcms.cmsCloseProfile(profile);
    for (const pointer of pointers) lcms._free(pointer);
  }
}

function content(document, page) {
  const value = page.node.Contents();
  const streams = value instanceof P.PDFArray ? value.asArray() : value ? [value] : [];
  return streams.map(ref => Buffer.from(decoded(document.context.lookup(ref))).toString('latin1')).join('\n');
}

// Native Figma fixtures put one instruction on each line. Compare all geometric
// and text instructions independently of the converter's parser; normalize only
// numeric spellings, which pdf-lib's serializer is allowed to change.
function geometryAndText(source) {
  const operators = new Set('q Q cm w J j M d ri i m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ Do sh gs'.split(' '));
  return source.split(/\r?\n/).map(line => line.trim()).filter(line => operators.has(line.split(/\s+/).at(-1)))
    .map(line => line.replace(/(?<![\w./])[-+]?(?:\d+\.?\d*|\.\d+)(?![\w.])/g, token => String(Number(token))));
}

function annotations(document, page) {
  const array = page.node.lookup(name('Annots'));
  return array ? array.asArray().map(ref => {
    const annotation = document.context.lookup(ref), action = annotation.lookup(name('A'));
    const destination = annotation.lookup(name('Dest')) || action?.lookup(name('D'));
    return {
      rectangle: annotation.lookup(name('Rect')).asArray().map(v => v.asNumber()),
      uri: action?.lookup(name('URI'))?.decodeText(),
      action: action?.get(name('S'))?.toString(),
      destination: destination instanceof P.PDFArray ? destination.asArray().map(v => v.toString()) : destination?.toString(),
    };
  }) : [];
}

function sourceProfile(document, page) {
  const spaces = page.node.Resources().lookup(name('ColorSpace'));
  const icc = spaces.lookup(name('C1'));
  return decoded(document.context.lookup(icc.get(1)));
}

function imageRecords(document, resources) {
  const objects = resources.lookup(name('XObject'));
  return objects ? objects.values().map(ref => document.context.lookup(ref)).filter(object => object.dict.get(name('Subtype'))?.toString() === '/Image') : [];
}

function assertIcc(document, colorSpace, destination) {
  colorSpace = document.context.lookup(colorSpace);
  assert(colorSpace instanceof P.PDFArray);
  assert.equal(colorSpace.get(0).toString(), '/ICCBased');
  const stream = document.context.lookup(colorSpace.get(1));
  assert.equal(stream.dict.lookup(name('N')).asNumber(), 4);
  assert.deepEqual(decoded(stream), destination);
  return colorSpace.get(1).toString();
}

function assertCmykResources(document, resources, destination, seen = new Set()) {
  if (seen.has(resources)) return;
  seen.add(resources);
  const spaces = resources.lookup(name('ColorSpace'));
  for (const value of spaces?.values() || []) assertIcc(document, value, destination);
  const objects = resources.lookup(name('XObject'));
  for (const ref of objects?.values() || []) {
    const object = document.context.lookup(ref);
    if (object.dict.get(name('Subtype'))?.toString() === '/Image') {
      assertIcc(document, object.dict.get(name('ColorSpace')), destination);
      const mask = object.dict.lookup(name('SMask'));
      if (mask) assert.equal(mask.dict.get(name('ColorSpace')).toString(), '/DeviceGray', 'soft masks remain grayscale alpha');
    } else {
      assert.equal(object.dict.get(name('Subtype')).toString(), '/Form');
      assertCmykPaint(Buffer.from(decoded(object)).toString('latin1'));
      assertCmykResources(document, object.dict.lookup(name('Resources')), destination, seen);
    }
  }
  for (const value of resources.lookup(name('Shading'))?.values() || []) assertIcc(document, document.context.lookup(value).get(name('ColorSpace')), destination);
  for (const value of resources.lookup(name('Pattern'))?.values() || []) {
    const pattern = document.context.lookup(value);
    assert.equal(pattern.lookup(name('PatternType')).asNumber(), 2);
    assertIcc(document, pattern.lookup(name('Shading')).get(name('ColorSpace')), destination);
  }
}

function assertCmykPaint(source) {
  for (const line of source.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/), operator = tokens.at(-1);
    assert(!['rg', 'RG', 'g', 'G', 'k', 'K', 'sc', 'SC'].includes(operator), `unconverted paint: ${line}`);
    if (operator === 'scn' || operator === 'SCN') {
      if (tokens.length === 2 && tokens[0].startsWith('/')) continue; // A colored shading pattern.
      assert.equal(tokens.length, 5, `CMYK must have four channels: ${line}`);
      assert(tokens.slice(0, 4).every(v => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1));
    }
    if (operator === 'cs' || operator === 'CS') assert(!['/DeviceRGB', '/DeviceGray', '/DeviceCMYK'].includes(tokens[0]));
  }
}

async function makePage(source, buildResources = () => ({})) {
  const document = await P.PDFDocument.create(), page = document.addPage([240, 160]);
  page.node.set(name('Resources'), document.context.obj(buildResources(document.context)));
  page.node.set(name('Contents'), document.context.register(document.context.flateStream(source)));
  return { document, page };
}

const defaultProfile = async document => createPdfColorManagement(P).getRasterProfile(document, read('color-profiles/native-SRGB.png'), 'PNG', 'SRGB').profile;
const cmykInstructions = source => source.split('\n').filter(line => /(?:^|\s)(?:scn|SCN)$/.test(line) && !line.startsWith('/'))
  .map(line => line.trim().split(/\s+/).slice(0, 4).map(Number));
const assertFloatColor = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert(Math.abs(value - expected[index] / 65535) <= 0.00000051,
    `channel ${index}: ${value} != ${expected[index]}/65535`));
};

test('native Figma links preserve every path/text instruction, font, annotation and page size', async () => {
  const destination = new Uint8Array(fs.readFileSync(path.join(__dirname, '../assets/color-profiles/ISOcoated_v2_300_bas.ICC')));
  const document = await P.PDFDocument.load(read('native-links.pdf')), page = document.getPage(0);
  const geometry = geometryAndText(content(document, page)), links = annotations(document, page);
  const fontRefs = page.node.Resources().lookup(name('Font')).values().map(String);
  assert(geometry.filter(line => line.endsWith(' c')).length > 900, 'fixture contains vector glyph outlines');
  assert.equal(links.length, 5);
  const session = await exporter().prepare(destination);
  try {
    const result = await converter().convertPage(document, page, session);
    assert.equal(result.stats.images, 0);
    assert.equal(result.stats.gradients, 0);
  } finally { session.close(); }
  const loaded = await P.PDFDocument.load(await document.save()), output = loaded.getPage(0);
  assert.deepEqual(output.getSize(), { width: 600, height: 400 });
  assert.deepEqual(geometryAndText(content(loaded, output)), geometry);
  assert.deepEqual(annotations(loaded, output), links);
  assert.deepEqual(output.node.Resources().lookup(name('Font')).values().map(String), fontRefs);
  assertCmykPaint(content(loaded, output));
  assertCmykResources(loaded, output.node.Resources(), destination);
});

for (const profile of ['SRGB', 'DISPLAY_P3_V4']) {
  test(`native ${profile} solids, JPEG, soft mask and calculator gradient use their actual source ICC`, async () => {
    const document = await P.PDFDocument.load(read(`color-profiles/swatches-${profile}.pdf`)), page = document.getPage(0), destination = printer();
    const source = sourceProfile(document, page), geometry = geometryAndText(content(document, page));
    const originalImage = imageRecords(document, page.node.Resources())[0];
    const originalMask = decoded(originalImage.dict.lookup(name('SMask')));
    const pixels = jpeg.decode(originalImage.contents, { useTArray: true, formatAsRGBA: false }).data;
    const expectedPixels = reference(source, destination, pixels, 8);
    const expectedRed = reference(source, destination, [1, 0, 0]);
    const samples = Array.from({ length: 4097 }, (_, i) => [1 - i / 4096, 0, i / 4096]).flat();
    const expectedGradient = reference(source, destination, samples);
    const session = await exporter().prepare(destination);
    try {
      const result = await converter().convertPage(document, page, session);
      assert.equal(result.stats.images, 1); assert.equal(result.stats.gradients, 1);
    } finally { session.close(); }
    const loaded = await P.PDFDocument.load(await document.save()), output = loaded.getPage(0), resources = output.node.Resources();
    assert.deepEqual(geometryAndText(content(loaded, output)), geometry);
    assertCmykPaint(content(loaded, output)); assertCmykResources(loaded, resources, destination);
    assert(cmykInstructions(content(loaded, output)).some(color => color.every((v, i) => Math.abs(v - expectedRed[i] / 65535) <= 0.00000051)), 'actual source ICC transforms solid red');
    const image = imageRecords(loaded, resources)[0];
    assert.deepEqual(decoded(image), expectedPixels);
    assert.deepEqual(decoded(image.dict.lookup(name('SMask'))), originalMask);
    const state = resources.lookup(name('ExtGState')).lookup(name('E1'));
    assert.equal(state.lookup(name('ca')).asNumber(), 0.5, 'normal alpha is retained');
    const pattern = resources.lookup(name('Pattern')).lookup(name('P1')), shading = pattern.lookup(name('Shading'));
    assert.equal(shading.lookup(name('ShadingType')).asNumber(), 2);
    const fn = shading.lookup(name('Function'));
    assert.equal(fn.dict.lookup(name('FunctionType')).asNumber(), 0);
    assert.equal(fn.dict.lookup(name('BitsPerSample')).asNumber(), 16);
    assert.deepEqual(fn.dict.lookup(name('Size')).asArray().map(v => v.asNumber()), [4097]);
    const bytes = decoded(fn), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.length, expectedGradient.length * 2);
    for (let i = 0; i < expectedGradient.length; i++) assert.equal(view.getUint16(i * 2), expectedGradient[i], `gradient sample ${i}`);
    const solidProfile = resources.lookup(name('ColorSpace')).values()[0];
    assert.equal(assertIcc(loaded, solidProfile, destination), assertIcc(loaded, image.dict.get(name('ColorSpace')), destination), 'one destination ICC is shared');
  });
}

test('16-bit solid operands honor RGB/Gray, stroke/fill, cs defaults and q/Q restoration', async () => {
  const { document, page } = await makePage('0.123456 0.54321 0.987654 rg\nq\n0.4 g\nQ\n0.222222 0.333333 0.777777 scn\n0.7 G\n/DeviceRGB CS\n0.125 0.25 0.875 SC\n1 0 0 RG\n0 0 50 50 re\nB\n');
  const source = await defaultProfile(document), destination = printer(), session = await exporter().prepare(destination);
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  const colors = cmykInstructions(content(document, page));
  const expectedRgb = [[0, 0, 0], [0, 0, 0], [0.123456, 0.54321, 0.987654], [0.4, 0.4, 0.4], [0.222222, 0.333333, 0.777777], [0.7, 0.7, 0.7], [0, 0, 0], [0.125, 0.25, 0.875], [1, 0, 0]];
  assert.equal(colors.length, expectedRgb.length);
  expectedRgb.forEach((rgb, i) => assertFloatColor(colors[i], reference(source, destination, rgb)));
  assertCmykPaint(content(document, page));
});

test('RGB and gray Flate images preserve a nonopaque gray soft mask without flattening', async () => {
  const rgb = Uint8Array.from([250, 30, 80, 25, 180, 200, 40, 80, 120, 255, 255, 255]), alpha = Uint8Array.from([0, 64, 128, 255]);
  const gray = Uint8Array.from([0, 64, 128, 255]);
  const { document, page } = await makePage('/Rgb Do\n/Gray Do\n', ctx => {
    const mask = ctx.register(ctx.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' }));
    return { XObject: {
      Rgb: ctx.register(ctx.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', SMask: mask })),
      Gray: ctx.register(ctx.flateStream(gray, { Type: 'XObject', Subtype: 'Image', Width: 4, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray' })),
    } };
  });
  const source = await defaultProfile(document), destination = printer(), session = await exporter().prepare(destination);
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  const loaded = await P.PDFDocument.load(await document.save()), images = imageRecords(loaded, loaded.getPage(0).node.Resources());
  assert.equal(images.length, 2);
  assert.deepEqual(decoded(images[0]), reference(source, destination, rgb, 8));
  assert.deepEqual(decoded(images[0].dict.lookup(name('SMask'))), alpha);
  assert.deepEqual(decoded(images[1]), reference(source, destination, Uint8Array.from(Array.from(gray, v => [v, v, v]).flat()), 8));
  assertCmykResources(loaded, loaded.getPage(0).node.Resources(), destination);
});

test('DefaultRGB overrides device RGB and repeated image uses convert only once', async () => {
  const native = await P.PDFDocument.load(read('color-profiles/swatches-DISPLAY_P3_V4.pdf'));
  const source = sourceProfile(native, native.getPage(0));
  const rgb = Uint8Array.from([225, 90, 15]);
  const { document, page } = await makePage('0.2 0.7 0.4 rg\n/I Do\n/Alias Do\n/I Do\n', ctx => {
    const image = ctx.register(ctx.flateStream(rgb, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' }));
    return { ColorSpace: { DefaultRGB: ['ICCBased', ctx.register(ctx.flateStream(source, { N: 3 }))] }, XObject: { I: image, Alias: image } };
  });
  const destination = printer(), session = await exporter().prepare(destination);
  try {
    const result = await converter().convertPage(document, page, session);
    assert.equal(result.stats.images, 1); assert.equal(result.stats.imagePixels, 1);
  } finally { session.close(); }
  const resources = page.node.Resources(), objects = resources.lookup(name('XObject'));
  assert.equal(objects.get(name('I')).toString(), objects.get(name('Alias')).toString());
  assert.deepEqual(decoded(objects.lookup(name('I'))), reference(source, destination, rgb, 8));
  assertFloatColor(cmykInstructions(content(document, page)).at(-1), reference(source, destination, [0.2, 0.7, 0.4]));
});

test('a shared image cannot silently reuse colors from another Form resource scope', async () => {
  const native = await P.PDFDocument.load(read('color-profiles/swatches-DISPLAY_P3_V4.pdf'));
  const p3 = sourceProfile(native, native.getPage(0)), srgb = await defaultProfile(native), destination = printer();
  const rgb = Uint8Array.from([225, 90, 15]);
  const expected = [reference(srgb, destination, rgb, 8), reference(p3, destination, rgb, 8)];
  assert.notDeepEqual(expected[0], expected[1], 'fixture distinguishes source profiles');
  const { document, page } = await makePage('/A Do\n/B Do\n', ctx => {
    const shared = ctx.register(ctx.flateStream(rgb, { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' }));
    const form = profile => ctx.register(ctx.flateStream('/I Do\n', { Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: {
      ColorSpace: { DefaultRGB: ['ICCBased', ctx.register(ctx.flateStream(profile, { N: 3 }))] }, XObject: { I: shared },
    } }));
    return { XObject: { A: form(srgb), B: form(p3) } };
  });
  const session = await exporter().prepare(destination);
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  const forms = page.node.Resources().lookup(name('XObject'));
  for (const [index, key] of ['A', 'B'].entries()) {
    const image = forms.lookup(name(key)).dict.lookup(name('Resources')).lookup(name('XObject')).lookup(name('I'));
    assert.deepEqual(decoded(image), expected[index], `Form ${key} source color space must be respected`);
  }
});

test('Form XObjects and normal searchable text stay vector; local and external annotations stay unchanged', async () => {
  let { document, page } = await makePage('q\n2 0 0 2 10 20 cm\n/Fm Do\nQ\n', ctx => ({ XObject: {
    Fm: ctx.register(ctx.flateStream('0.2 0.4 0.7 rg\n0 0 m\n30 50 l\n60 0 l\nh\nf\n', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 60, 50], Matrix: [1, 0, 0, 1, 0, 0], Resources: {} })),
  } }));
  const font = await document.embedFont(P.StandardFonts.Helvetica);
  page.drawText('Searchable vector text', { x: 20, y: 100, font, size: 12, color: P.rgb(0.2, 0.3, 0.6) });
  const target = document.addPage([100, 200]);
  page.node.set(name('Annots'), document.context.obj([
    document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 20, 30, 40], A: { S: 'URI', URI: P.PDFString.of('https://example.com/vector') } })),
    document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 50, 80, 90], Dest: [target.ref, 'Fit'] })),
  ]));
  // Match a native imported PDF: pdf-lib drawing starts as PDFContentStream.
  document = await P.PDFDocument.load(await document.save()); page = document.getPage(0);
  const before = annotations(document, page), geometry = geometryAndText(content(document, page)), destination = printer();
  const originalForm = page.node.Resources().lookup(name('XObject')).lookup(name('Fm'));
  const formGeometry = geometryAndText(Buffer.from(decoded(originalForm)).toString('latin1'));
  const session = await exporter().prepare(destination);
  try {
    const result = await converter().convertPage(document, page, session);
    assert.equal(result.stats.forms, 1); assert.equal(result.stats.images, 0);
  } finally { session.close(); }
  const loaded = await P.PDFDocument.load(await document.save()), output = loaded.getPage(0), resources = output.node.Resources();
  assert.deepEqual(geometryAndText(content(loaded, output)), geometry);
  assert.deepEqual(annotations(loaded, output), before);
  const form = resources.lookup(name('XObject')).lookup(name('Fm'));
  assert.deepEqual(geometryAndText(Buffer.from(decoded(form)).toString('latin1')), formGeometry);
  assert.equal(resources.lookup(name('Font')).values().length, 1);
  assertCmykPaint(content(loaded, output)); assertCmykResources(loaded, resources, destination);
});

test('radial vector shading and stitching functions are sampled after ICC conversion', async () => {
  const { document, page } = await makePage('/Shade sh\n', ctx => ({ Shading: {
    Shade: ctx.obj({ ShadingType: 3, ColorSpace: 'DeviceRGB', Coords: [0, 0, 0, 40, 30, 50], Extend: [true, true], Function: {
      FunctionType: 3, Domain: [0, 1], Bounds: [0.5], Encode: [0, 1, 0, 1], Functions: [
        { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 1, 0], N: 1 },
        { FunctionType: 2, Domain: [0, 1], C0: [0, 1, 0], C1: [0, 0, 1], N: 2 },
      ],
    } }),
  } }));
  const source = await defaultProfile(document), destination = printer(), session = await exporter().prepare(destination);
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  const shading = page.node.Resources().lookup(name('Shading')).lookup(name('Shade'));
  assert.equal(shading.lookup(name('ShadingType')).asNumber(), 3);
  assert.deepEqual(shading.lookup(name('Coords')).asArray().map(v => v.asNumber()), [0, 0, 0, 40, 30, 50]);
  const converted = require('../src/pdf-functions').createPdfFunctionEvaluator(P).compile(document, shading.get(name('Function')));
  assert.equal(shading.lookup(name('Function')).lookup(name('FunctionType')).asNumber(), 3);
  for (const [index, rgb] of [[0, [1, 0, 0]], [1024, [0.5, 0.5, 0]], [2048, [0, 1, 0]], [3072, [0, 0.75, 0.25]], [4096, [0, 0, 1]]]) {
    const expected = reference(source, destination, rgb);
    for (let channel = 0; channel < 4; channel++) assert.equal(Math.round(converted([index / 4096])[channel] * 65535), expected[channel]);
  }
});

for (const kind of ['stitching', 'calculator']) test(`narrow ${kind} gradient bands and hard stops survive CMYK conversion`, async () => {
  const { document, page } = await makePage('/Shade sh\n', ctx => {
    const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const fn = kind === 'stitching' ? ctx.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [0.50005, 0.50010], Encode: [0, 1, 0, 1, 0, 1],
      Functions: colors.map(color => ({ FunctionType: 2, Domain: [0, 1], C0: color, C1: color, N: 1 })) })
      : ctx.flateStream('{ dup 0.50005 gt { dup 0.50010 gt { pop 0 0 1 } { pop 0 1 0 } ifelse } { pop 1 0 0 } ifelse }', { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1] });
    return { Shading: { Shade: ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 100, 0], Function: ctx.register(fn) }) } };
  });
  const source = await defaultProfile(document), destination = printer(), session = await exporter().prepare(destination);
  let result;
  try { result = await converter().convertPage(document, page, session); } finally { session.close(); }
  const shading = page.node.Resources().lookup(name('Shading')).lookup(name('Shade'));
  const fn = require('../src/pdf-functions').createPdfFunctionEvaluator(P).compile(document, shading.get(name('Function')));
  for (const [t, rgb] of [[0.49999, [1, 0, 0]], [0.500075, [0, 1, 0]], [0.50011, [0, 0, 1]]]) {
    const expected = reference(source, destination, rgb);
    assert.deepEqual(fn([t]).map(v => Math.round(v * 65535)), Array.from(expected));
  }
  assert.equal(result.warnings.some(text => /gradient.*approximated/.test(text)), kind === 'calculator');
});

test('opaque path Alpha masks preserve mask geometry and groups without converting luminosity to ink', async () => {
  const outline = 'q\n1 0 0 1 51 72 cm\n0 0 0 scn\n0 12 m\n101 12 l\n101 0 l\n0 0 l\nh\nf\nn\nQ\n';
  const { document, page } = await makePage('/DeviceRGB cs\n/Gs gs\n/Fm Do\n', ctx => {
    const mask = ctx.register(ctx.flateStream(outline, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 240, 160],
      Group: { Type: 'Group', S: 'Transparency' }, Resources: {} }));
    const form = ctx.register(ctx.flateStream('0.25 0.5 0.75 scn\n0 0 240 160 re\nf\n', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 240, 160], Group: { S: 'Transparency', I: true }, Resources: {},
    }));
    return { ExtGState: { Gs: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Alpha', G: mask }, BM: 'Multiply', ca: 0.7 } }, XObject: { Fm: form } };
  });
  page.node.set(name('Group'), document.context.obj({ S: 'Transparency', CS: 'DeviceRGB' }));
  const destination = printer(), source = await defaultProfile(document), session = await exporter().prepare(destination);
  let result;
  try { result = await converter().convertPage(document, page, session); } finally { session.close(); }
  const loaded = await P.PDFDocument.load(await document.save()), output = loaded.getPage(0), resources = output.node.Resources();
  const state = resources.lookup(name('ExtGState')).lookup(name('Gs')), mask = state.lookup(name('SMask'));
  const maskForm = mask.lookup(name('G'));
  assert.equal(state.get(name('BM')).toString(), '/Multiply');
  assert.equal(state.lookup(name('ca')).asNumber(), 0.7);
  assert.equal(mask.get(name('S')).toString(), '/Alpha');
  assert.equal(maskForm.dict.lookup(name('Group')).get(name('CS')).toString(), '/DeviceGray');
  assert.equal(maskForm.dict.lookup(name('Resources')).keys().length, 0);
  assert.deepEqual(geometryAndText(Buffer.from(decoded(maskForm)).toString('latin1')), geometryAndText(outline));
  assert(!/\b(?:scn|rg|cs)\b/.test(Buffer.from(decoded(maskForm)).toString('latin1')), 'alpha shape has explicit gray colors, independent of the CMYK parent');
  const form = resources.lookup(name('XObject')).lookup(name('Fm'));
  assert.equal(form.dict.lookup(name('Group')).get(name('I')).toString(), 'true');
  assertIcc(loaded, form.dict.lookup(name('Group')).get(name('CS')), destination);
  assertIcc(loaded, output.node.lookup(name('Group')).get(name('CS')), destination);
  assertFloatColor(cmykInstructions(Buffer.from(decoded(form)).toString('latin1'))[0], reference(source, destination, [0.25, 0.5, 0.75]));
  assert(result.warnings.some(warning => /transparency.*different/i.test(warning)));
});

test('unused unsupported resources are neither interpreted nor retained in the output resource table', async () => {
  const { document, page } = await makePage('0.2 0.3 0.4 rg\n0 0 20 30 re\nf\n', ctx => ({
    ExtGState: { Unused: { BM: 'Screen', SMask: { S: 'Luminosity' } } },
    XObject: { Unused: ctx.register(ctx.flateStream(new Uint8Array(), { Subtype: 'Image', Width: 99999, Height: 99999 })) },
    Font: { Unused: { Subtype: 'Type3', CharProcs: {} } },
    Shading: { Unused: { ShadingType: 4 } }, Pattern: { Unused: { PatternType: 1 } },
  }));
  const session = await exporter().prepare(printer());
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  for (const key of ['ExtGState', 'XObject', 'Font', 'Shading', 'Pattern']) assert.equal(page.node.Resources().lookup(name(key)).keys().length, 0, key);
  assertCmykPaint(content(document, page));
});

test('a Form may explicitly share its parent resource dictionary without a drawing recursion', async () => {
  let resourcesRef;
  const { document, page } = await makePage('/DeviceRGB cs\n/Fm Do\n', ctx => {
    const resources = ctx.obj({}); resourcesRef = ctx.register(resources);
    const form = ctx.register(ctx.flateStream('0.2 0.4 0.6 scn\n0 0 20 30 re\nf\n', {
      Subtype: 'Form', BBox: [0, 0, 240, 160], Resources: resourcesRef,
    }));
    resources.set(name('XObject'), ctx.obj({ Fm: form })); return resources;
  });
  page.node.set(name('Resources'), resourcesRef);
  const loaded = await P.PDFDocument.load(await document.save()), output = loaded.getPage(0), destination = printer();
  const source = await defaultProfile(loaded), session = await exporter().prepare(destination);
  try { await converter().convertPage(loaded, output, session); } finally { session.close(); }
  const form = output.node.Resources().lookup(name('XObject')).lookup(name('Fm'));
  assert.equal(form.dict.lookup(name('Resources')), output.node.Resources());
  assertFloatColor(cmykInstructions(Buffer.from(decoded(form)).toString('latin1'))[0], reference(source, destination, [0.2, 0.4, 0.6]));
  await P.PDFDocument.load(await loaded.save());
});

test('the same Form gets separate color conversions for inherited sRGB and Display P3', async () => {
  const nativeP3 = await P.PDFDocument.load(read('color-profiles/swatches-DISPLAY_P3_V4.pdf'));
  const p3 = sourceProfile(nativeP3, nativeP3.getPage(0));
  const { document, page } = await makePage('/DeviceRGB cs\n/Fm Do\n/P3 cs\n/Fm Do\n/Fm_2 Do\n', ctx => ({
    ColorSpace: { P3: ['ICCBased', ctx.register(ctx.flateStream(p3, { N: 3 }))] },
    XObject: { Fm: ctx.register(ctx.flateStream('0.8 0.2 0.4 scn\n0 0 20 30 re\nf\n', { Subtype: 'Form', BBox: [0, 0, 240, 160], Resources: {} })),
      Fm_2: ctx.register(ctx.flateStream(new Uint8Array([128, 128, 128]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' })),
    },
  }));
  const source = await defaultProfile(document), destination = printer(), session = await exporter().prepare(destination);
  try { await converter().convertPage(document, page, session); } finally { session.close(); }
  const used = [...content(document, page).matchAll(/\/(\w+) Do/g)].map(match => name(match[1]));
  assert.equal(used.length, 3); assert.notEqual(used[0], used[1]);
  assert.notEqual(used[1], used[2], 'generated Form variant must not collide with an existing source image name');
  assert.equal(page.node.Resources().lookup(name('XObject')).lookup(used[2]).dict.get(name('Subtype')).toString(), '/Image');
  for (let i = 0; i < 2; i++) {
    const form = page.node.Resources().lookup(name('XObject')).lookup(used[i]);
    assertFloatColor(cmykInstructions(Buffer.from(decoded(form)).toString('latin1'))[0], reference(i ? p3 : source, destination, [0.8, 0.2, 0.4]));
  }
});

test('unsupported PDF constructs are refused without replacing the page contents or resources', async t => {
  const session = await exporter().prepare(printer());
  const cases = [
    ['device CMYK', '0 0 0 1 k\n0 0 10 10 re\nf\n', () => ({}), /CMYK/],
    ['spot color', '/Spot cs\n0.5 scn\n', ctx => ({ ColorSpace: { Spot: ctx.obj(['Separation', 'Ink', 'DeviceRGB', { FunctionType: 2, Domain: [0, 1], C0: [1, 1, 1], C1: [1, 0, 0], N: 1 }]) } }), /color space/],
    ['indexed color', '/Indexed cs\n0 scn\n', ctx => ({ ColorSpace: { Indexed: ctx.obj(['Indexed', 'DeviceRGB', 0, P.PDFHexString.of('ff0000')]) } }), /color space/],
    ['calibrated RGB', '/Cal cs\n0 0 0 scn\n', ctx => ({ ColorSpace: { Cal: ctx.obj(['CalRGB', { WhitePoint: [0.9505, 1, 1.089] }]) } }), /color space/],
    ['mesh shading', '/Mesh sh\n', ctx => ({ Shading: { Mesh: ctx.obj({ ShadingType: 4, ColorSpace: 'DeviceRGB' }) } }), /gradients/],
    ['tiling pattern', '/Pattern cs\n/P scn\n', ctx => ({ Pattern: { P: ctx.register(ctx.flateStream('', { PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 1, 1], XStep: 1, YStep: 1, Resources: {} })) } }), /Tiling|Invalid PDF resource dictionary/],
    ['blend mode', '/Gs gs\n', () => ({ ExtGState: { Gs: { BM: 'Screen' } } }), /blend mode/],
    ['luminosity soft mask', '/Gs gs\n', () => ({ ExtGState: { Gs: { SMask: { S: 'Luminosity' } } } }), /soft masks/],
    ['alpha mask with transfer function', '/Gs gs\n', ctx => ({ ExtGState: { Gs: { SMask: { S: 'Alpha', TR: 'Identity', G: ctx.register(ctx.flateStream('', { Subtype: 'Form', Group: { S: 'Transparency' } })) } } } }), /transfer functions/],
    ['alpha mask with nested graphics state', '/Gs gs\n', ctx => ({ ExtGState: { Gs: { SMask: { S: 'Alpha', G: ctx.register(ctx.flateStream('/Nested gs\n', { Subtype: 'Form', Group: { S: 'Transparency' }, Resources: { ExtGState: { Nested: { ca: 0.5 } } } })) } } } }), /alpha mask.*graphics states/],
    ['transfer function', '/Gs gs\n', () => ({ ExtGState: { Gs: { TR: 'Identity' } } }), /TR/],
    ['inline image', 'BI /W 1 /H 1 /BPC 8 /CS /RGB ID abc EI\n', () => ({}), /instruction/],
    ['painted Type3 font', '/F 12 Tf\n', ctx => ({ Font: { F: ctx.obj({ Subtype: 'Type3', CharProcs: { A: ctx.register(ctx.flateStream('0 0 0 0 10 10 d1\n0 0 10 10 re\nf\n')) } }) } }), /Type3/],
    ['image Matte', '/I Do\n', ctx => ({ XObject: { I: ctx.register(ctx.flateStream(Uint8Array.from([255, 0, 0]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Matte: [1, 1, 1] })) } }), /Matte/],
    ['custom image Decode', '/I Do\n', ctx => ({ XObject: { I: ctx.register(ctx.flateStream(Uint8Array.from([255, 0, 0]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Decode: [1, 0, 1, 0, 1, 0] })) } }), /decode/],
    ['oversized image metadata', '/I Do\n', ctx => ({ XObject: { I: ctx.register(ctx.flateStream(new Uint8Array(), { Subtype: 'Image', Width: 4001, Height: 4000, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' })) } }), /16 million/],
    ['truncated image', '/I Do\n', ctx => ({ XObject: { I: ctx.register(ctx.flateStream(Uint8Array.from([1, 2]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' })) } }), /Incomplete image/],
    ['soft-mask Matte', '/I Do\n', ctx => {
      const mask = ctx.register(ctx.flateStream(Uint8Array.from([128]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Matte: [1, 1, 1] }));
      return { XObject: { I: ctx.register(ctx.flateStream(Uint8Array.from([10, 30, 50]), { Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', SMask: mask })) } };
    }, /Matte/],
    ['knockout transparency Form group', '/Fm Do\n', ctx => ({ XObject: { Fm: ctx.register(ctx.flateStream('', { Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: {}, Group: { S: 'Transparency', CS: 'DeviceRGB', K: true } })) } }), /Knockout/],
    ['recursive Form with inherited resources', '/Fm Do\n', ctx => ({ XObject: { Fm: ctx.register(ctx.flateStream('/Fm Do\n', { Subtype: 'Form', BBox: [0, 0, 1, 1] })) } }), /Recursive/],
    ['mutually recursive Forms with inherited resources', '/A Do\n', ctx => ({ XObject: {
      A: ctx.register(ctx.flateStream('/B Do\n', { Subtype: 'Form', BBox: [0, 0, 1, 1] })),
      B: ctx.register(ctx.flateStream('/A Do\n', { Subtype: 'Form', BBox: [0, 0, 1, 1] })),
    } }), /Recursive/],
    ['unbalanced save', 'q\n', () => ({}), /Unbalanced/],
    ['unbalanced restore', 'Q\n', () => ({}), /Unbalanced/],
  ];
  try {
    for (const [label, source, resources, expected] of cases) await t.test(label, async () => {
      const { document, page } = await makePage(source, resources), beforeContents = page.node.Contents(), beforeResources = page.node.Resources();
      await assert.rejects(converter().convertPage(document, page, session), expected);
      assert.equal(page.node.Contents(), beforeContents); assert.equal(page.node.Resources(), beforeResources);
    });
    await t.test('knockout page transparency group', async () => {
      const { document, page } = await makePage(''); page.node.set(name('Group'), document.context.obj({ S: 'Transparency', CS: 'DeviceRGB', K: true }));
      await assert.rejects(converter().convertPage(document, page, session), /Knockout/);
    });
    await t.test('annotation appearance', async () => {
      const { document, page } = await makePage('');
      page.node.set(name('Annots'), document.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], AP: {} }]));
      await assert.rejects(converter().convertPage(document, page, session), /annotations/);
    });
    await t.test('document output intent', async () => {
      const { document, page } = await makePage('');
      document.catalog.set(name('OutputIntents'), document.context.obj([{ S: 'GTS_PDFX', OutputConditionIdentifier: P.PDFString.of('Unconverted print condition') }]));
      await assert.rejects(converter().convertPage(document, page, session), /Document-wide output profiles/);
    });
  } finally { session.close(); }
});

test('combined drawing streams are bounded before parsing', async () => {
  const { document, page } = await makePage(''), large = new Uint8Array(8 * 1024 * 1024 + 1).fill(32);
  const first = document.context.register(document.context.flateStream(large)), second = document.context.register(document.context.flateStream(large));
  const third = document.context.register(document.context.flateStream('0 0 10 10 re\nf\n'));
  page.node.set(name('Contents'), document.context.obj([first, second, third]));
  const before = page.node.Contents(), session = await exporter().prepare(printer());
  const decodedStreams = [];
  const observed = createVectorCmykConverter({ ...P, decodePDFRawStream(stream) {
    decodedStreams.push(stream); return P.decodePDFRawStream(stream);
  } });
  try { await assert.rejects(observed.convertPage(document, page, session), /16 MiB/); }
  finally { session.close(); }
  assert.equal(page.node.Contents(), before);
  assert.deepEqual(decodedStreams, [document.context.lookup(first), document.context.lookup(second)], 'later streams must not decode once the cumulative budget is exhausted');
});

test('cancellation before and during image conversion leaves the page unchanged', async () => {
  const { document, page } = await makePage('/I Do\n', ctx => ({ XObject: {
    I: ctx.register(ctx.flateStream(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128]), { Subtype: 'Image', Width: 4, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' })),
  } }));
  const beforeContents = page.node.Contents(), beforeResources = page.node.Resources();
  let active = true, yields = 0;
  const session = await exporter({ chunkPixels: 1, yieldToBrowser: async () => { if (++yields === 2) active = false; } }).prepare(printer());
  try {
    await assert.rejects(converter().convertPage(document, page, session, { stillActive: () => false }), /cancelled/);
    assert.equal(yields, 0);
    await assert.rejects(converter().convertPage(document, page, session, { stillActive: () => active }), /cancelled/);
    assert.equal(yields, 2);
    assert.equal(page.node.Contents(), beforeContents); assert.equal(page.node.Resources(), beforeResources);
  } finally { session.close(); }
});

test('a color-only vector instruction sequence yields so queued cancellation can run', async () => {
  const { document, page } = await makePage('0.2 0.4 0.6 rg\n'.repeat(9000));
  const beforeContents = page.node.Contents(), beforeResources = page.node.Resources();
  const session = await exporter().prepare(printer());
  let active = true, timerRan = false;
  // A resolved Promise only yields to microtasks. User input needs the next
  // browser task, which the drawing loop must reach even on color-op continues.
  const timer = setTimeout(() => { active = false; timerRan = true; }, 0);
  try {
    await assert.rejects(converter().convertPage(document, page, session, { stillActive: () => active }), /cancelled/);
    assert.equal(timerRan, true);
    assert.equal(page.node.Contents(), beforeContents); assert.equal(page.node.Resources(), beforeResources);
  } finally { clearTimeout(timer); session.close(); }
});

test('many short Form streams share a cancellation yield budget', async () => {
  const { document, page } = await makePage(Array.from({ length: 50 }, (_, i) => `/F${i} Do\n`).join(''), ctx => ({
    XObject: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`F${i}`, ctx.register(ctx.flateStream('0.2 0.4 0.6 rg\n'.repeat(100), {
      Subtype: 'Form', BBox: [0, 0, 240, 160], Resources: {},
    }))])),
  }));
  const beforeContents = page.node.Contents(), beforeResources = page.node.Resources();
  const session = await exporter().prepare(printer());
  let active = true;
  const timer = setTimeout(() => { active = false; }, 0);
  try {
    await assert.rejects(converter().convertPage(document, page, session, { stillActive: () => active }), /cancelled/);
    assert.equal(page.node.Contents(), beforeContents); assert.equal(page.node.Resources(), beforeResources);
  } finally { clearTimeout(timer); session.close(); }
});
