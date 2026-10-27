const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('pdf-lib');
const UPNG = require('@pdf-lib/upng').default;
const { createCmykExporter } = require('../src/cmyk');
const { createPdfColorManagement } = require('../src/color-profiles');
const fixtures = path.join(__dirname, 'fixtures/color-profiles');
const fixture = name => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const printer = () => fixture('synthetic-cmyk-test-only.icc');
let constants, lcms;
test.before(async () => {
  constants = await import('lcms-wasm');
  lcms = await constants.instantiate({ wasmBinary: new Uint8Array(fs.readFileSync(require.resolve('lcms-wasm/dist/lcms.wasm'))) });
});
const loadEngine = async () => ({ lcms, constants });
const exporter = options => createCmykExporter(P, { loadEngine, yieldToBrowser: () => Promise.resolve(), ...options });
const png = (rgba, width, height) => new Uint8Array(UPNG.encode([Uint8Array.from(rgba).buffer], width, height, 0));

function imageRecord(document, page) {
  const objects = page.node.Resources().lookup(P.PDFName.of('XObject'), P.PDFDict);
  const image = objects.values().map(ref => document.context.lookup(ref)).find(object => object.dict.get(P.PDFName.of('Subtype'))?.toString() === '/Image');
  const color = image.dict.lookup(P.PDFName.of('ColorSpace'), P.PDFArray);
  assert.equal(color.get(0).toString(), '/ICCBased');
  const profile = document.context.lookup(color.get(1), P.PDFRawStream);
  return { image, profile, profileRef: color.get(1).toString(), pixels: P.decodePDFRawStream(image).decode(), profileBytes: P.decodePDFRawStream(profile).decode() };
}

function referenceTransform(sourceBytes, destinationBytes, rgb) {
  const handles = [], pointers = [];
  let transform = 0;
  const open = bytes => {
    const pointer = lcms._malloc(bytes.length); pointers.push(pointer); lcms.HEAPU8.set(bytes, pointer);
    const handle = lcms._cmsOpenProfileFromMem(pointer, bytes.length); assert(handle); handles.push(handle); return handle;
  };
  try {
    transform = lcms.cmsCreateTransform(open(sourceBytes), constants.TYPE_RGB_8, open(destinationBytes), constants.TYPE_CMYK_8, constants.INTENT_RELATIVE_COLORIMETRIC, constants.cmsFLAGS_BLACKPOINTCOMPENSATION | constants.cmsFLAGS_NOCACHE);
    assert(transform);
    return lcms.cmsDoTransform(transform, rgb, rgb.length / 3);
  } finally {
    if (transform) lcms.cmsDeleteTransform(transform);
    for (const handle of handles) lcms.cmsCloseProfile(handle);
    for (const pointer of pointers) lcms._free(pointer);
  }
}

test('real CMYK conversion, white alpha, ICCBased N4 and image bytes survive PDF save', async () => {
  const destination = printer(), document = await P.PDFDocument.create();
  const input = png([255, 0, 0, 255, 255, 0, 0, 128, 255, 0, 0, 0, 20, 120, 240, 255], 4, 1);
  const source = createPdfColorManagement(P).getRasterProfile(document, input, 'PNG', 'SRGB').profile;
  const expected = referenceTransform(source, destination, Uint8Array.from([255, 0, 0, 255, 127, 127, 255, 255, 255, 20, 120, 240]));
  const session = await exporter({ chunkPixels: 2 }).prepare(destination);
  assert.match(session.profileName, /TEST ONLY/);
  assert.equal(session.renderingIntent, 'relative-colorimetric');
  assert.equal(session.blackPointCompensation, true);
  const result = await session.embedPng(document, input);
  assert.equal(result.width, 4); assert.equal(result.height, 1);
  const page = document.addPage([400, 100]); page.drawImage(result.image, { x: 0, y: 0, width: 400, height: 100 });
  await result.image.embed(); // Root's ordinary image path may call this again.
  session.close(); session.close();
  const loaded = await P.PDFDocument.load(await document.save());
  const record = imageRecord(loaded, loaded.getPage(0));
  assert.deepEqual(record.pixels, expected);
  assert.deepEqual(record.profileBytes, destination);
  assert.equal(record.profile.dict.lookup(P.PDFName.of('N')).asNumber(), 4);
  assert.equal(record.profile.dict.get(P.PDFName.of('Alternate')).toString(), '/DeviceCMYK');
  assert.equal(record.image.dict.get(P.PDFName.of('SMask')), undefined, 'alpha was flattened');
  assert.equal(record.image.dict.get(P.PDFName.of('Decode')), undefined, 'raw CMYK must not use JPEG inversion');
  assert.equal(record.image.dict.get(P.PDFName.of('Filter')).toString(), '/FlateDecode');
  assert.equal(loaded.catalog.get(P.PDFName.of('OutputIntents')), undefined, 'no PDF/X declaration is invented');
});

test('actual embedded source ICC is used and destination ICC is shared within a PDF', async () => {
  const document = await P.PDFDocument.create(), destination = printer();
  const input = fixture('native-DISPLAY_P3_V4.png');
  const source = createPdfColorManagement(P).getRasterProfile(document, input, 'PNG', 'SRGB').profile;
  const decoded = await P.PngEmbedder.for(input);
  const expected = referenceTransform(source, destination, decoded.image.rgbChannel);
  const session = await exporter().prepare(destination);
  for (let index = 0; index < 2; index++) {
    const { image } = await session.embedPng(document, input);
    document.addPage([120, 80]).drawImage(image, { x: 0, y: 0, width: 120, height: 80 });
  }
  session.close();
  const loaded = await P.PDFDocument.load(await document.save());
  const first = imageRecord(loaded, loaded.getPage(0)), second = imageRecord(loaded, loaded.getPage(1));
  assert.deepEqual(first.pixels, expected);
  assert.equal(first.profileRef, second.profileRef);
});

test('conversion chunks bound WASM scratch and allow cancellation before adding an image', async () => {
  const calls = [], original = lcms._cmsDoTransform;
  lcms._cmsDoTransform = (transform, input, output, count) => { calls.push(count); return original(transform, input, output, count); };
  let stillActive = true, yields = 0;
  const session = await exporter({ chunkPixels: 2, yieldToBrowser: async () => { if (++yields === 3) stillActive = false; } }).prepare(printer());
  const document = await P.PDFDocument.create();
  const before = document.context.enumerateIndirectObjects().length;
  try {
    await assert.rejects(session.embedPng(document, png(Array(10).fill([0, 80, 180, 255]).flat(), 10, 1), { stillActive: () => stillActive }), /cancelled/);
    assert.deepEqual(calls, [2, 2]);
    assert.equal(document.context.enumerateIndirectObjects().length, before);
  } finally { lcms._cmsDoTransform = original; session.close(); }
});

test('closing during a yielded conversion is safe and future work is rejected', async () => {
  let session, yields = 0;
  session = await exporter({ chunkPixels: 1, yieldToBrowser: async () => { if (++yields === 2) session.close(); } }).prepare(printer());
  const document = await P.PDFDocument.create(), input = png([0, 0, 0, 255, 255, 255, 255, 255], 2, 1);
  await assert.rejects(session.embedPng(document, input), /cancelled/);
  await assert.rejects(session.embedPng(document, input), /cancelled/);
  session.close();
});

test('parallel pages are rejected, and every raw allocation/profile/transform is released', async () => {
  const allocated = new Set(), handles = new Set(), transforms = new Set();
  const originals = {};
  const intercept = (name, replacement) => { originals[name] = lcms[name]; lcms[name] = replacement(originals[name]); };
  intercept('_malloc', original => size => { const pointer = original(size); allocated.add(pointer); return pointer; });
  intercept('_free', original => pointer => { allocated.delete(pointer); return original(pointer); });
  intercept('_cmsOpenProfileFromMem', original => (pointer, size) => { const handle = original(pointer, size); if (handle) handles.add(handle); return handle; });
  intercept('cmsCloseProfile', original => handle => { handles.delete(handle); return original(handle); });
  intercept('cmsCreateTransform', original => (...args) => { const transform = original(...args); if (transform) transforms.add(transform); return transform; });
  intercept('cmsDeleteTransform', original => transform => { transforms.delete(transform); return original(transform); });
  let unblock;
  const pause = new Promise(resolve => { unblock = resolve; });
  let session;
  try {
    session = await exporter({ yieldToBrowser: () => pause }).prepare(printer());
    const document = await P.PDFDocument.create(), input = png([1, 2, 3, 255], 1, 1);
    const first = session.embedPng(document, input);
    await assert.rejects(session.embedPng(document, input), /one at a time/);
    unblock(); await first; session.close();
    assert.equal(allocated.size, 0); assert.equal(handles.size, 0); assert.equal(transforms.size, 0);
  } finally { unblock(); session?.close(); for (const [name, original] of Object.entries(originals)) lcms[name] = original; }
});

function renameTags(bytes, prefix) {
  const copy = Buffer.from(bytes), count = copy.readUInt32BE(128);
  for (let index = 0; index < count; index++) {
    const offset = 132 + index * 12;
    if (copy.toString('ascii', offset, offset + 3) === prefix) copy.write(`${prefix.slice(0, 2)}X`, offset);
  }
  return new Uint8Array(copy);
}

test('invalid, oversized, RGB, device-link and one-way ICCs fail before a job starts', async () => {
  const factory = exporter(), rgb = createPdfColorManagement(P).getRasterProfile(await P.PDFDocument.create(), fixture('native-SRGB.png'), 'PNG', 'SRGB').profile;
  await assert.rejects(factory.prepare(rgb), /CMYK output\/printer/);
  await assert.rejects(factory.prepare(new Uint8Array(16 * 1024 * 1024 + 1)), /16 MiB/);
  await assert.rejects(factory.prepare(printer().subarray(0, 200)), /header/);
  const deviceLink = printer(); deviceLink.set(Buffer.from('link'), 12);
  await assert.rejects(factory.prepare(deviceLink), /device link/);
  await assert.rejects(factory.prepare(renameTags(printer(), 'B2A')), /convert RGB/);
  await assert.rejects(factory.prepare(renameTags(printer(), 'A2B')), /PDF rendering/);
  const corruptReverse = Buffer.from(printer());
  for (let index = 0; index < corruptReverse.readUInt32BE(128); index++) {
    const offset = 132 + index * 12;
    if (corruptReverse.toString('ascii', offset, offset + 3) === 'A2B') corruptReverse.write('BAD!', corruptReverse.readUInt32BE(offset + 4));
  }
  await assert.rejects(factory.prepare(new Uint8Array(corruptReverse)), /usable|rendering|could not/i, 'both actual transform directions must work, not only tag names');
  const badTag = Buffer.from(printer()); badTag.writeUInt32BE(badTag.length + 4, 136);
  await assert.rejects(factory.prepare(new Uint8Array(badTag)), /outside the profile/);
});

test('a large valid ICC is opened from heap rather than the smaller WASM stack', async () => {
  const bytes = new Uint8Array(16 * 1024 * 1024); bytes.set(printer());
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  const session = await exporter().prepare(bytes);
  assert.match(session.profileName, /TEST ONLY/);
  session.close();
});

test('pixel limits are checked before decoding and allocation', async () => {
  const session = await exporter().prepare(printer()), document = await P.PDFDocument.create();
  const bytes = fixture('native-SRGB.png');
  new DataView(bytes.buffer).setUint32(16, 4000); new DataView(bytes.buffer).setUint32(20, 4000);
  await assert.rejects(session.embedPng(document, bytes), /8 million pixels/);
  await assert.rejects(session.embedPng(document, new Uint8Array([1, 2, 3])), /valid sRGB PNG/);
  session.close();
});

test('offline browser bundle instantiates without network and creates a real CMYK image', { timeout: 30000 }, async t => {
  const { chromium } = require('@playwright/test');
  const { buildCmykBundle } = await import('../scripts/build.mjs');
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
  const pdf = fs.readFileSync(require.resolve('pdf-lib/dist/pdf-lib.min.js'), 'utf8');
  const colors = fs.readFileSync(path.join(__dirname, '../src/color-profiles.js'), 'utf8');
  const cmyk = fs.readFileSync(path.join(__dirname, '../src/cmyk.js'), 'utf8');
  await page.setContent('<!doctype html><title>Offline CMYK regression</title>');
  for (const content of [pdf, colors, await buildCmykBundle(), cmyk]) await page.addScriptTag({ content });
  const result = await page.evaluate(async ({ profile, image }) => {
    const session = await createCmykExporter(PDFLib, { loadEngine: loadCmykEngine }).prepare(new Uint8Array(profile));
    const document = await PDFLib.PDFDocument.create();
    const converted = await session.embedPng(document, new Uint8Array(image));
    const page = document.addPage([120, 80]); page.drawImage(converted.image, { width: 120, height: 80 });
    session.close();
    const bytes = await document.save();
    const engine = await loadCmykEngine();
    return { bytes: [...bytes], version: engine.constants.LCMS_VERSION };
  }, { profile: [...printer()], image: [...fixture('native-SRGB.png')] });
  const loaded = await P.PDFDocument.load(new Uint8Array(result.bytes));
  assert.equal(imageRecord(loaded, loaded.getPage(0)).profile.dict.lookup(P.PDFName.of('N')).asNumber(), 4);
  assert.equal(result.version, 2160); assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
