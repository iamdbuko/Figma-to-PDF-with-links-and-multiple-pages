// pdf-lib 1.17.1 ignores indirect stream Length values while locating endstream.
// Its fallback can consume a binary trailing CR as part of a CR/LF separator.
// Keep exact source offsets on a private parser instance, then use resolved Length
// values to recover only the original omitted newline bytes. No checksum guesses,
// byte searches, dependency edits, or global/prototype patches are involved.
function createPdfLoader(PDFLib) {
  const { PDFParser, PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFRef } = PDFLib;
  if (!PDFParser?.forBytesWithOptions || !PDFDocument || !PDFRawStream || !PDFNumber || !PDFRef) {
    throw new Error('The pinned PDF importer is unavailable.');
  }
  const MAX_INPUT_BYTES = 128 * 1024 * 1024;
  const MAX_STREAMS = 65536;
  const lengthKey = PDFName.of('Length');
  const endstream = [101, 110, 100, 115, 116, 114, 101, 97, 109];
  const fail = message => { throw new Error(`Invalid PDF stream: ${message}`); };

  function sourceBytes(input) {
    // Normalize Buffer/subarray inputs without copying the entire document.
    if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new Error('The PDF importer requires binary PDF bytes.');
  }

  function exactBoundary(bytes, end, parsedEnd) {
    // Only the separator already consumed by this parse may follow the declared
    // data. Do not search for another endstream in arbitrary binary contents.
    let offset = end;
    if (bytes[offset] === 13) offset++;
    if (bytes[offset] === 10) offset++;
    if (offset + endstream.length !== parsedEnd) return false;
    return endstream.every((value, index) => bytes[offset + index] === value);
  }

  async function load(input, options = {}) {
    const bytes = sourceBytes(input);
    if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error('The PDF importer accepts up to 128 MiB per source PDF.');
    const {
      ignoreEncryption = false, parseSpeed = PDFLib.ParseSpeeds?.Slow ?? 100,
      throwOnInvalidObject = false, updateMetadata = true, capNumbers = false
    } = options;
    if (![ignoreEncryption, throwOnInvalidObject, updateMetadata, capNumbers].every(value => typeof value === 'boolean') ||
        typeof parseSpeed !== 'number' || !(parseSpeed > 0)) throw new Error('Invalid PDF importer options.');
    // This is the same parser/document construction used by PDFDocument.load in
    // pinned 1.17.1. Instance-local interception supplies the missing byte ranges.
    const parser = PDFParser.forBytesWithOptions(bytes, parseSpeed, throwOnInvalidObject, capNumbers);
    if (!parser.bytes?.slice || typeof parser.parseDictOrStream !== 'function') throw new Error('The pinned PDF parser interface has changed.');
    const originalParse = parser.parseDictOrStream;
    const streams = [];
    const streamReferences = new WeakMap();
    const originalAssign = parser.context.assign;
    const hadOwnAssign = Object.prototype.hasOwnProperty.call(parser.context, 'assign');
    parser.context.assign = function (ref, object) {
      if (object instanceof PDFRawStream) streamReferences.set(object, ref);
      return originalAssign.call(this, ref, object);
    };
    let captureError = null;
    parser.parseDictOrStream = function () {
      const byteStream = this.bytes, originalSlice = byteStream.slice;
      let captured = null;
      byteStream.slice = function (start, end) {
        const contents = originalSlice.call(this, start, end);
        captured = { start, end, contents };
        return contents;
      };
      try {
        const object = originalParse.call(this);
        if (object instanceof PDFRawStream) {
          if (!captured || captured.contents !== object.contents || streams.length >= MAX_STREAMS) {
            captureError = new Error('The PDF importer could not safely record its stream boundaries.');
            throw captureError;
          }
          streams.push({ stream: object, start: captured.start, end: captured.end, parsedEnd: byteStream.offset() });
        }
        return object;
      } finally {
        byteStream.slice = originalSlice;
      }
    };
    let context;
    try { context = await parser.parseDocument(); }
    finally {
      if (hadOwnAssign) parser.context.assign = originalAssign;
      else delete parser.context.assign;
    }
    if (captureError) throw captureError;
    for (const { stream, start, end, parsedEnd } of streams) {
      // An incremental revision may replace both a stream and its Length object.
      // Only skip a stream proven replaced at its own indirect reference; merely
      // being absent from context is insufficient. ObjStm/XRef are consumed by
      // the parser without assign(), so their strict checks always remain active.
      const ref = streamReferences.get(stream);
      const current = ref && context.lookup(ref);
      if (ref && current !== undefined && current !== stream) continue;
      const lengthObject = stream.dict.get(lengthKey);
      if (!(lengthObject instanceof PDFNumber) && !(lengthObject instanceof PDFRef)) fail('missing or unsupported Length.');
      const resolved = context.lookup(lengthObject);
      if (!(resolved instanceof PDFNumber)) fail('the indirect Length could not be resolved.');
      const length = resolved.asNumber();
      if (!Number.isSafeInteger(length) || length < 0 || start < 0 || start + length > bytes.length) fail('Length is outside the source bytes.');
      if (length === end - start) continue;
      const omitted = length - (end - start);
      if (!(lengthObject instanceof PDFRef) || omitted < 1 || omitted > 2 ||
          !exactBoundary(bytes, start + length, parsedEnd)) fail('Length does not match the source boundary.');
      for (let offset = end; offset < start + length; offset++) {
        if (bytes[offset] !== 13 && bytes[offset] !== 10) fail('Length mismatch is not an omitted line ending.');
      }
      // PDFRawStream stores these bytes directly; its size getter has no cache.
      // The existing dictionary and all references retain their original identity.
      stream.contents = bytes.slice(start, start + length);
    }
    return new PDFDocument(context, ignoreEncryption, updateMetadata);
  }
  return { load };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createPdfLoader };
