const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const P = require('pdf-lib');
const { createPdfLoader } = require('../src/pdf-loader.js');
const loader = createPdfLoader(P);
const options = { updateMetadata: false, throwOnInvalidObject: true };

// Synthetic PDF only: no customer document content belongs in this regression.
function makePdf(contents, { indirect = true, separator = '\n', declaredLength = contents.length, unresolved = false, filter = true } = {}) {
  const parts = [Buffer.from('%PDF-1.7\n')], offsets = [0];
  const object = (number, body) => {
    offsets[number] = parts.reduce((total, part) => total + part.length, 0);
    parts.push(Buffer.from(`${number} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n'));
  };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources <<>> /Contents 4 0 R >>');
  object(4, Buffer.concat([
    Buffer.from(`<< /Length ${indirect ? (unresolved ? '99 0 R' : '5 0 R') : declaredLength}${filter ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
    Buffer.from(contents), Buffer.from(`${separator}endstream`)
  ]));
  object(5, String(declaredLength));
  const xref = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

function compressedEndingCR() {
  for (let count = 0; count < 256; count++) {
    const plain = Buffer.from(`0 0 1 rg 0 0 10 10 re f\n% Synthetic stream ${'a'.repeat(count)}\n`);
    const compressed = zlib.deflateSync(plain);
    if (compressed.at(-1) === 13) return { plain, compressed };
  }
  throw new Error('Could not construct synthetic checksum fixture');
}
const fixture = compressedEndingCR();
const contents = document => document.getPage(0).node.lookup(P.PDFName.of('Contents'), P.PDFRawStream).contents;
const equalBytes = (actual, expected) => assert.deepEqual(Buffer.from(actual), Buffer.from(expected));

function appendRevision(input, changes) {
  const previous = [...Buffer.from(input).toString('latin1').matchAll(/startxref\n(\d+)\n/g)].at(-1)[1];
  const parts = [Buffer.from(input)], offsets = [];
  for (const [number, body] of changes) {
    offsets.push([number, parts.reduce((total, part) => total + part.length, 0)]);
    parts.push(Buffer.from(`${number} 0 obj\n`), Buffer.from(body), Buffer.from('\nendobj\n'));
  }
  const xref = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.from(`xref\n${offsets.map(([number, offset]) => `${number} 1\n${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${Math.max(5, ...changes.map(([number]) => number)) + 1} /Root 1 0 R /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

function streamObject(bytes, extra = '', length = '5 0 R') {
  return Buffer.concat([Buffer.from(`<< /Length ${length} ${extra} >>\nstream\n`), Buffer.from(bytes), Buffer.from('\nendstream')]);
}

test('pinned upstream loader demonstrably drops a binary CR with an indirect Length', async () => {
  assert.equal(fixture.compressed.at(-1), 13);
  const document = await P.PDFDocument.load(makePdf(fixture.compressed), options);
  assert.equal(contents(document).length, fixture.compressed.length - 1);
  assert.throws(() => zlib.inflateSync(contents(document)), /unexpected end/i);
  const saved = await P.PDFDocument.load(await document.save(), options);
  assert.equal(contents(saved).length, fixture.compressed.length - 1, 'saving makes the lost byte permanent');
});

test('local loader preserves exact compressed bytes through import, copyPages and save', async () => {
  const input = makePdf(fixture.compressed), snapshot = input.slice();
  const document = await loader.load(input, options);
  equalBytes(contents(document), fixture.compressed);
  equalBytes(zlib.inflateSync(contents(document)), fixture.plain);
  equalBytes(input, snapshot);
  const output = await P.PDFDocument.create();
  const [page] = await output.copyPages(document, [0]); output.addPage(page);
  const saved = await P.PDFDocument.load(await output.save(), options);
  const streams = saved.getPage(0).node.Contents();
  const content = streams instanceof P.PDFArray ? streams.lookup(0, P.PDFRawStream) : streams;
  equalBytes(content.contents, fixture.compressed);
  equalBytes(zlib.inflateSync(content.contents), fixture.plain);
});

test('direct lengths and LF/CRLF separators remain byte-for-byte identical', async () => {
  for (const indirect of [false, true]) for (const separator of ['\n', '\r\n', '\r']) {
    const document = await loader.load(makePdf(fixture.compressed, { indirect, separator }), options);
    equalBytes(contents(document), fixture.compressed);
  }
});

test('unfiltered binary trailing CR/LF bytes are recovered from Length, never a checksum guess', async () => {
  for (const suffix of [[13], [10], [13, 10], [13, 13], [10, 13]]) {
    const binary = new Uint8Array([0, 1, 2, 255, 128, ...suffix]);
    for (const separator of ['', '\n', '\r\n']) {
      const document = await loader.load(makePdf(binary, { filter: false, separator }), options);
      equalBytes(contents(document), binary);
    }
  }
});

test('inconsistent, unresolved, negative and oversized lengths fail explicitly', async () => {
  await assert.rejects(loader.load(makePdf(fixture.compressed, { unresolved: true }), options), /indirect Length/);
  for (const declaredLength of [-1, 0, 4.5, fixture.compressed.length + 10, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(loader.load(makePdf(fixture.compressed, { declaredLength }), options), /Invalid PDF stream/);
  }
  await assert.rejects(loader.load(makePdf(fixture.compressed, { declaredLength: fixture.compressed.length - 2 }), options), /Length does not match/);
  await assert.rejects(loader.load(makePdf(fixture.compressed, { indirect: false, declaredLength: fixture.compressed.length + 2 }), options), /Length does not match/);
});

test('already-truncated files are not repaired by inventing bytes absent from their source', async () => {
  const truncated = fixture.compressed.subarray(0, -1);
  const document = await loader.load(makePdf(truncated), options);
  equalBytes(contents(document), truncated);
  assert.throws(() => zlib.inflateSync(contents(document)), /unexpected end/i);
});

test('incremental replacement validates and repairs only the active ordinary stream', async () => {
  const old = zlib.deflateSync(Buffer.from('0 0 10 10 re f\n'));
  assert.notEqual(old.length, fixture.compressed.length);
  const input = appendRevision(makePdf(old), [
    [4, streamObject(fixture.compressed, '/Filter /FlateDecode')],
    [5, String(fixture.compressed.length)]
  ]);
  const document = await loader.load(input, options);
  equalBytes(contents(document), fixture.compressed);
  equalBytes(zlib.inflateSync(contents(document)), fixture.plain);
  const reloaded = await loader.load(await document.save(), options);
  equalBytes(contents(reloaded), fixture.compressed);
});

test('incremental updates cannot bypass validation of active streams or changed lengths', async () => {
  const input = makePdf(fixture.compressed);
  // Updating Length alone does not prove the stream was superseded.
  await assert.rejects(loader.load(appendRevision(input, [[5, '2']]), options), /Length does not match/);
  // The replacement is still validated even though the old stream is skipped.
  const malformed = appendRevision(input, [
    [4, streamObject(fixture.compressed, '/Filter /FlateDecode')], [5, '2']
  ]);
  await assert.rejects(loader.load(malformed, options), /Length does not match/);
});

test('consumed object and cross-reference streams are not mistaken for superseded streams', async () => {
  const base = makePdf(fixture.compressed, { indirect: false });
  for (const [extra, body] of [
    ['/Type /ObjStm /N 1 /First 5', Buffer.from('11 0 123')],
    ['/Type /XRef /Size 1 /W [1 1 1] /Root 1 0 R', Buffer.from([0, 0, 255])]
  ]) {
    const valid = appendRevision(base, [[9, streamObject(body, extra, '10 0 R')], [10, String(body.length)]]);
    const document = await loader.load(valid, options);
    assert.equal(document.context.lookup(P.PDFRef.of(9)), undefined, 'pdf-lib consumes this stream without registering it');
    equalBytes(contents(document), fixture.compressed);
    const malformed = appendRevision(base, [[9, streamObject(body, extra, '10 0 R')], [10, '1']]);
    await assert.rejects(loader.load(malformed, options), /Length does not match/);
    const unresolved = appendRevision(base, [[9, streamObject(body, extra, '10 0 R')]]);
    await assert.rejects(loader.load(unresolved, options), /indirect Length/);
  }
});

test('concurrent imports and byte-offset views do not patch shared parser methods', async () => {
  const parserFactory = P.PDFParser.forBytesWithOptions, prototypeParser = P.PDFObjectParser.prototype.parseDictOrStream;
  const input = makePdf(fixture.compressed), backing = new Uint8Array(input.length + 32);
  backing.fill(255); backing.set(input, 17);
  const documents = await Promise.all([
    loader.load(backing.subarray(17, 17 + input.length), { ...options, parseSpeed: 1 }),
    loader.load(input.buffer.slice(0), { ...options, parseSpeed: 1 }),
    P.PDFDocument.load(makePdf(fixture.compressed, { indirect: false }), options)
  ]);
  for (const document of documents) equalBytes(contents(document), fixture.compressed);
  assert.equal(P.PDFParser.forBytesWithOptions, parserFactory);
  assert.equal(P.PDFObjectParser.prototype.parseDictOrStream, prototypeParser);
  assert.equal(backing[16], 255);
  assert.equal(backing[17 + input.length], 255);
});

test('native Figma fixture, annotations and pdf-lib object-stream output still load', async () => {
  const input = fs.readFileSync(path.join(__dirname, 'fixtures/native-links.pdf'));
  const document = await loader.load(input, options);
  const original = await P.PDFDocument.load(input, options);
  assert.equal(document.getPageCount(), original.getPageCount());
  assert.equal(document.getPage(0).node.Annots().size(), original.getPage(0).node.Annots().size());
  const saved = await loader.load(await document.save(), options);
  assert.equal(saved.getPageCount(), original.getPageCount());
  assert.equal(saved.getPage(0).node.Annots().size(), original.getPage(0).node.Annots().size());
});

test('the exact minified production library exposes the same private parser interface', async () => {
  const bundled = require('pdf-lib/dist/pdf-lib.min.js');
  const document = await createPdfLoader(bundled).load(makePdf(fixture.compressed), options);
  const stream = document.getPage(0).node.lookup(bundled.PDFName.of('Contents'), bundled.PDFRawStream);
  equalBytes(stream.contents, fixture.compressed);
  equalBytes(zlib.inflateSync(stream.contents), fixture.plain);
});

test('invalid binary inputs and parser options are rejected', async () => {
  await assert.rejects(loader.load('not binary'), /binary PDF bytes/);
  await assert.rejects(loader.load(new Uint8Array()), /128 MiB/);
  await assert.rejects(loader.load(makePdf(fixture.compressed), { parseSpeed: 0 }), /options/);
  await assert.rejects(loader.load(makePdf(fixture.compressed), { updateMetadata: 'false' }), /options/);
});
