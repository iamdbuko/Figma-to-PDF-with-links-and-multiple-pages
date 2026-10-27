const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const PDFLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = PDFLib;
const { createPdfColorManagement } = require('../src/color-profiles');
const fixtures = path.join(__dirname, 'fixtures/color-profiles');
const read = name => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function imageOnPage(document, page) {
  const objects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  return objects.values().map(ref => document.context.lookup(ref)).find(object => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image');
}

function imageProfile(document, image) {
  const color = image.dict.lookup(PDFName.of('ColorSpace'), PDFArray);
  assert.equal(color.get(0).toString(), '/ICCBased');
  const stream = document.context.lookup(color.get(1), PDFRawStream);
  assert.equal(stream.dict.lookup(PDFName.of('N')).asNumber(), 3);
  assert.equal(stream.dict.get(PDFName.of('Alternate')).toString(), '/DeviceRGB');
  return { ref: color.get(1).toString(), bytes: decodePDFRawStream(stream).decode() };
}

async function assemble(name, format, profileName, helper = createPdfColorManagement(PDFLib), document = null) {
  document ||= await PDFDocument.create();
  const bytes = read(name);
  const image = format === 'JPG' ? await document.embedJpg(bytes) : await document.embedPng(bytes);
  const before = hash(bytes);
  const result = await helper.attachRasterProfile(document, image, bytes, format, profileName);
  assert.equal(hash(bytes), before, 'input bytes are never changed');
  const page = document.addPage([120, 80]); page.drawImage(image, { x: 0, y: 0, width: 120, height: 80 });
  return { document, page, image, bytes, result };
}

test('P3 JPEG and PNG preserve the exact embedded ICC and deduplicate it per PDF', async () => {
  const helper = createPdfColorManagement(PDFLib), document = await PDFDocument.create();
  const png = await assemble('native-DISPLAY_P3_V4.png', 'PNG', 'DISPLAY_P3_V4', helper, document);
  const jpg = await assemble('native-DISPLAY_P3_V4.jpg', 'JPG', 'DISPLAY_P3_V4', helper, document);
  const originalJpeg = document.context.lookup(jpg.image.ref, PDFRawStream);
  assert.deepEqual(originalJpeg.contents, jpg.bytes, 'compressed JPEG bytes pass through unchanged');
  assert.equal(originalJpeg.dict.get(PDFName.of('Filter')).toString(), '/DCTDecode');
  const first = imageProfile(document, document.context.lookup(png.image.ref));
  const second = imageProfile(document, originalJpeg);
  assert.equal(first.ref, second.ref);
  assert.equal(first.bytes.length, 536);
  assert.deepEqual(first.bytes, second.bytes);
  assert.deepEqual(Buffer.from(first.bytes), iccFromJpeg(jpg.bytes), 'the real native profile bytes survive unchanged');
  const loaded = await PDFDocument.load(await document.save());
  const savedPng = imageProfile(loaded, imageOnPage(loaded, loaded.getPage(0)));
  const savedJpegImage = imageOnPage(loaded, loaded.getPage(1));
  const savedJpeg = imageProfile(loaded, savedJpegImage);
  assert.equal(savedPng.ref, savedJpeg.ref);
  assert.deepEqual(savedPng.bytes, first.bytes);
  assert.deepEqual(savedJpegImage.contents, jpg.bytes);
});

test('sRGB PNG metadata and explicit sRGB JPEG use the same stable RGB ICC', async () => {
  const helper = createPdfColorManagement(PDFLib), document = await PDFDocument.create();
  await assemble('native-SRGB.png', 'PNG', 'DOCUMENT', helper, document);
  await assemble('native-SRGB.jpg', 'JPG', 'SRGB', helper, document);
  const loaded = await PDFDocument.load(await document.save());
  const first = imageProfile(loaded, imageOnPage(loaded, loaded.getPage(0)));
  const second = imageProfile(loaded, imageOnPage(loaded, loaded.getPage(1)));
  assert.equal(first.ref, second.ref);
  assert.equal(first.bytes.length, 588);
  assert.equal(Buffer.from(first.bytes).toString('ascii', 36, 40), 'acsp');
  assert.equal(Buffer.from(first.bytes).toString('ascii', 16, 20), 'RGB ');
  assert.equal(Buffer.from(first.bytes).readUInt16BE(24), 2026);
  assert.equal(Buffer.from(first.bytes).readUInt16BE(26), 1);
  assert.equal(Buffer.from(first.bytes).readUInt16BE(28), 1);
  assert.equal(loaded.catalog.get(PDFName.of('OutputIntents')), undefined);
});

test('separate documents own their ICC streams and mixed profiles remain distinct', async () => {
  const helper = createPdfColorManagement(PDFLib);
  const first = await assemble('native-SRGB.jpg', 'JPG', 'SRGB', helper);
  await assemble('native-DISPLAY_P3_V4.jpg', 'JPG', 'DISPLAY_P3_V4', helper, first.document);
  const second = await assemble('native-DISPLAY_P3_V4.png', 'PNG', 'DISPLAY_P3_V4', helper);
  const loadedFirst = await PDFDocument.load(await first.document.save());
  const loadedSecond = await PDFDocument.load(await second.document.save());
  const srgb = imageProfile(loadedFirst, imageOnPage(loadedFirst, loadedFirst.getPage(0)));
  const p3 = imageProfile(loadedFirst, imageOnPage(loadedFirst, loadedFirst.getPage(1)));
  assert.notEqual(srgb.ref, p3.ref);
  assert.notEqual(hash(srgb.bytes), hash(p3.bytes));
  assert.deepEqual(imageProfile(loadedSecond, imageOnPage(loadedSecond, loadedSecond.getPage(0))).bytes, p3.bytes);
});

test('missing P3 metadata and untagged DOCUMENT JPEG fail without a guessed color profile', async () => {
  const helper = createPdfColorManagement(PDFLib), document = await PDFDocument.create();
  const image = { embed() { assert.fail('must reject before embedding'); } };
  await assert.rejects(helper.attachRasterProfile(document, image, read('native-SRGB.jpg'), 'JPG', 'DISPLAY_P3_V4'), /Display P3 image is missing/);
  await assert.rejects(helper.attachRasterProfile(document, image, read('native-SRGB.jpg'), 'JPG', 'DOCUMENT'), /color profile is unknown/);
});

function iccFromJpeg(bytes) {
  const buffer = Buffer.from(bytes), magic = buffer.indexOf(Buffer.from('ICC_PROFILE\0'));
  assert(magic > 0);
  return buffer.subarray(magic + 14, magic - 2 + buffer.readUInt16BE(magic - 2));
}

function jpegWithChunks(chunks) {
  const segments = chunks.map(({ data, sequence, count }) => {
    const body = Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([sequence, count]), data]);
    const header = Buffer.from([255, 226, 0, 0]); header.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([header, body]);
  });
  return new Uint8Array(Buffer.concat([Buffer.from([255, 216]), ...segments, Buffer.from([255, 218])]));
}

test('JPEG ICC segments reassemble by sequence and reject duplicates, gaps, and truncated profiles', async () => {
  const profile = iccFromJpeg(read('native-DISPLAY_P3_V4.jpg'));
  const helper = createPdfColorManagement(PDFLib), document = await PDFDocument.create();
  const image = await document.embedJpg(read('native-SRGB.jpg'));
  const split = [profile.subarray(0, 200), profile.subarray(200)];
  const reversed = jpegWithChunks([{ data: split[1], sequence: 2, count: 2 }, { data: split[0], sequence: 1, count: 2 }]);
  await helper.attachRasterProfile(document, image, reversed, 'JPG', 'DISPLAY_P3_V4');
  assert.deepEqual(Buffer.from(imageProfile(document, document.context.lookup(image.ref)).bytes), profile);
  const noEmbed = { embed() { assert.fail('invalid metadata must be rejected before embedding'); } };
  for (const malformed of [
    jpegWithChunks([{ data: split[0], sequence: 1, count: 2 }]),
    jpegWithChunks([{ data: split[0], sequence: 1, count: 2 }, { data: split[1], sequence: 1, count: 2 }]),
    jpegWithChunks([{ data: profile.subarray(0, 130), sequence: 1, count: 1 }]),
    reversed.subarray(0, reversed.length - 5)
  ]) await assert.rejects(helper.attachRasterProfile(document, noEmbed, malformed, 'JPG', 'DISPLAY_P3_V4'), /Invalid image color profile/);
});

function pngWithProfile(compressed) {
  const original = Buffer.from(read('native-SRGB.png'));
  const prefix = original.subarray(0, 33);
  const data = Buffer.concat([Buffer.from('ICC\0\0'), compressed]);
  const typeAndData = Buffer.concat([Buffer.from('iCCP'), data]);
  let crc = 0xffffffff;
  for (const byte of typeAndData) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const header = Buffer.alloc(4), footer = Buffer.alloc(4); header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  // Color parser stops before image pixels. An empty IDAT header is sufficient here.
  const idat = Buffer.from([0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0]);
  return new Uint8Array(Buffer.concat([prefix, header, typeAndData, footer, idat]));
}

test('PNG profile inflation is bounded and checks compressed, chunk, and ICC structure integrity', async () => {
  const helper = createPdfColorManagement(PDFLib), document = await PDFDocument.create();
  const noEmbed = { embed() { assert.fail('invalid metadata must be rejected before embedding'); } };
  const profile = iccFromJpeg(read('native-DISPLAY_P3_V4.jpg'));
  const oversized = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024));
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, pngWithProfile(oversized), 'PNG', 'DISPLAY_P3_V4'), /too large/);
  const badAdler = zlib.deflateSync(profile); badAdler[badAdler.length - 1] ^= 1;
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, pngWithProfile(badAdler), 'PNG', 'DISPLAY_P3_V4'), /compression checksum/);
  const badTag = Buffer.from(profile); badTag.writeUInt32BE(profile.length + 4, 136);
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, pngWithProfile(zlib.deflateSync(badTag)), 'PNG', 'DISPLAY_P3_V4'), /ICC tag/);
  const badColor = Buffer.from(profile); badColor.write('CMYK', 16);
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, pngWithProfile(zlib.deflateSync(badColor)), 'PNG', 'DISPLAY_P3_V4'), /RGB pixels/);
  const badCrc = pngWithProfile(zlib.deflateSync(profile)); badCrc[45] ^= 1;
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, badCrc, 'PNG', 'DISPLAY_P3_V4'), /metadata checksum/);
  const truncated = read('native-DISPLAY_P3_V4.png').subarray(0, 80);
  await assert.rejects(helper.attachRasterProfile(document, noEmbed, truncated, 'PNG', 'DISPLAY_P3_V4'), /truncated/);
});

function iccHashes(document) {
  return document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('N'))?.toString() === '3')
    .map(([, stream]) => hash(decodePDFRawStream(stream).decode())).sort();
}

for (const profile of ['SRGB', 'DISPLAY_P3_V4']) test(`native ${profile} page resources preserve real ICC bytes through copy and save`, async () => {
  const source = await PDFDocument.load(read(`swatches-${profile}.pdf`));
  const document = await PDFDocument.create(), helper = createPdfColorManagement(PDFLib);
  const [copied] = await document.copyPages(source, [0]);
  await helper.preserveNativeColorProfile(document, source, source.getPage(0), copied, profile);
  document.addPage(copied);
  const loaded = await PDFDocument.load(await document.save());
  assert(iccHashes(source).length > 0);
  assert.deepEqual(iccHashes(loaded), iccHashes(source));
  assert.equal(loaded.catalog.get(PDFName.of('OutputIntents')), undefined);
});

test('unknown native catalog output-intent dependencies request a raster fallback', async () => {
  const source = await PDFDocument.load(read('swatches-SRGB.pdf'));
  source.catalog.set(PDFName.of('OutputIntents'), source.context.obj([{ Type: 'OutputIntent', S: 'GTS_PDFX' }]));
  const document = await PDFDocument.create(), [copied] = await document.copyPages(source, [0]);
  await assert.rejects(createPdfColorManagement(PDFLib).preserveNativeColorProfile(document, source, source.getPage(0), copied, 'SRGB'), /raster fallback/);
  assert.equal(document.catalog.get(PDFName.of('OutputIntents')), undefined);
});

test('helper loads as a plain browser script without Node modules', async () => {
  const sandbox = vm.createContext({ Uint8Array, DataView, WeakMap, Map, Set, atob, PDFLib });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/color-profiles.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.createPdfColorManagement, 'function');
  const helper = sandbox.createPdfColorManagement(PDFLib);
  const { document } = await assemble('native-SRGB.jpg', 'JPG', 'SRGB', helper);
  assert.equal(imageProfile(document, imageOnPage(document, document.getPage(0))).bytes.length, 588);
});
