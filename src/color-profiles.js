// Color management for pdf-lib 1.17.1. No pixel conversion or JPEG decoding.
// sRGB profile generated with Pillow ImageCms.createProfile('sRGB'), LittleCMS
// 2.19. Its copyright tag reads "No copyright, use freely". Creation time is
// fixed to 2026-01-01T00:00:00 and the optional profile ID is zeroed for a stable
// artifact. This is an RGB display profile, not a PDF/X output-intent claim.
const PDF_EXPORT_SRGB_ICC = 'AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oAAQABAAAAAAAAYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c';

function createPdfColorManagement(PDFLib) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
  const MAX_ICC_BYTES = 1024 * 1024;
  const MAX_HEADER_BYTES = 2 * 1024 * 1024;
  // References and profile keys disappear when the document is released.
  const profilesByDocument = new WeakMap();
  const sRGB = Uint8Array.from(atob(PDF_EXPORT_SRGB_ICC), character => character.charCodeAt(0));
  const text = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const uint32 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
  const invalid = message => { throw new Error(`Invalid image color profile: ${message}`); };

  function validateProfile(bytes) {
    if (bytes.length < 132 || bytes.length > MAX_ICC_BYTES) invalid('unsupported ICC size.');
    if (uint32(bytes, 0) !== bytes.length || text(bytes, 36, 4) !== 'acsp') invalid('invalid ICC header.');
    if (![2, 4].includes(bytes[8])) invalid('unsupported ICC version.');
    if (text(bytes, 16, 4) !== 'RGB ' || !['XYZ ', 'Lab '].includes(text(bytes, 20, 4))) invalid('the ICC profile must describe RGB pixels.');
    if (!['mntr', 'scnr', 'prtr', 'spac'].includes(text(bytes, 12, 4))) invalid('unsupported ICC profile class.');
    const count = uint32(bytes, 128);
    if (count === 0 || count > 4096 || 132 + count * 12 > bytes.length) invalid('invalid ICC tag table.');
    const signatures = new Set();
    for (let index = 0; index < count; index++) {
      const offset = 132 + index * 12, signature = text(bytes, offset, 4);
      const start = uint32(bytes, offset + 4), length = uint32(bytes, offset + 8);
      if (signatures.has(signature) || start % 4 || start < 132 + count * 12 || length < 8 || start + length > bytes.length) invalid('an ICC tag is duplicated or outside the profile.');
      signatures.add(signature);
    }
    // These are structural checks, not a full colorimetric ICC conformance test.
    if (!signatures.has('wtpt') || !(signatures.has('A2B0') || ['rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC'].every(tag => signatures.has(tag)))) invalid('missing RGB transform tags.');
    return bytes;
  }
  validateProfile(sRGB);

  function crc32(bytes, start, end) {
    let crc = 0xffffffff;
    for (let index = start; index < end; index++) {
      crc ^= bytes[index];
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function inflateProfile(pdfDoc, compressed) {
    if (compressed.length < 6 || compressed.length > MAX_ICC_BYTES) invalid('unsupported compressed ICC size.');
    const stream = decodePDFRawStream(pdfDoc.context.stream(compressed, { Filter: 'FlateDecode' }));
    // pdf-lib's decoder can finish a whole deflate block before getBytes returns.
    // Bound its allocation itself, not merely the requested output length.
    const ensureBuffer = stream.ensureBuffer;
    if (typeof ensureBuffer !== 'function') invalid('the bounded ICC decoder is unavailable.');
    stream.ensureBuffer = function (requested) {
      if (requested > MAX_ICC_BYTES) invalid('the decompressed ICC profile is too large.');
      return ensureBuffer.call(this, requested);
    };
    let profile;
    try { profile = stream.decode(); }
    catch (error) { invalid(`ICC decompression failed (${error.message}).`); }
    if (profile.length > MAX_ICC_BYTES) invalid('the decompressed ICC profile is too large.');
    // pdf-lib's Flate decoder does not check the zlib Adler-32 trailer.
    let a = 1, b = 0;
    for (const byte of profile) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    if ((((b << 16) | a) >>> 0) !== uint32(compressed, compressed.length - 4)) invalid('incorrect ICC compression checksum.');
    return validateProfile(profile.slice());
  }

  function pngProfile(pdfDoc, bytes) {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) invalid('invalid PNG header.');
    let offset = 8, profile = null, isSRGB = false;
    while (offset + 12 <= bytes.length) {
      if (offset > MAX_HEADER_BYTES) invalid('PNG color metadata is too large.');
      const length = uint32(bytes, offset), type = text(bytes, offset + 4, 4), start = offset + 8;
      if (length > bytes.length - offset - 12) invalid('truncated PNG chunk.');
      if (offset === 8 && (type !== 'IHDR' || length !== 13)) invalid('missing PNG image header.');
      if (type === 'IDAT' || type === 'IEND') return { profile, isSRGB };
      if (type === 'iCCP' || type === 'sRGB') {
        if (length > MAX_ICC_BYTES || crc32(bytes, offset + 4, start + length) !== uint32(bytes, start + length)) invalid('incorrect PNG color metadata checksum.');
        if (profile || isSRGB) invalid('conflicting PNG color profiles.');
        if (type === 'sRGB') {
          if (length !== 1 || bytes[start] > 3) invalid('invalid PNG sRGB rendering intent.');
          isSRGB = true;
        } else {
          const data = bytes.subarray(start, start + length), separator = data.indexOf(0);
          if (separator < 1 || separator > 79 || separator + 2 >= length || data[separator + 1] !== 0) invalid('invalid PNG ICC chunk.');
          profile = inflateProfile(pdfDoc, data.subarray(separator + 2));
        }
      }
      offset += length + 12;
    }
    invalid('truncated PNG color metadata.');
  }

  function jpegProfile(bytes) {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) invalid('invalid JPEG header.');
    const chunks = new Map();
    let offset = 2, expected = null, total = 0, ended = false;
    while (offset < bytes.length) {
      if (offset > MAX_HEADER_BYTES) invalid('JPEG color metadata is too large.');
      if (bytes[offset++] !== 255) invalid('invalid JPEG marker.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) { ended = true; break; }
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) invalid('truncated JPEG segment.');
      const length = (bytes[offset] << 8) | bytes[offset + 1], start = offset + 2;
      if (length < 2 || offset + length > bytes.length) invalid('truncated JPEG segment.');
      if (marker === 226 && text(bytes, start, Math.min(12, length - 2)) === 'ICC_PROFILE\0') {
        if (length < 16) invalid('truncated JPEG ICC segment.');
        const sequence = bytes[start + 12], count = bytes[start + 13];
        if (!sequence || !count || sequence > count || chunks.has(sequence) || (expected !== null && expected !== count)) invalid('invalid JPEG ICC segment sequence.');
        expected = count;
        const data = bytes.subarray(start + 14, offset + length);
        total += data.length;
        if (total > MAX_ICC_BYTES) invalid('the JPEG ICC profile is too large.');
        chunks.set(sequence, data);
      }
      offset += length;
    }
    if (!ended) invalid('truncated JPEG metadata.');
    if (expected === null) return { profile: null, isSRGB: false };
    if (chunks.size !== expected) invalid('missing JPEG ICC segments.');
    const profile = new Uint8Array(total);
    let position = 0;
    for (let sequence = 1; sequence <= expected; sequence++) {
      const chunk = chunks.get(sequence);
      if (!chunk) invalid('missing JPEG ICC segments.');
      profile.set(chunk, position); position += chunk.length;
    }
    return { profile: validateProfile(profile), isSRGB: false };
  }

  function profileReference(pdfDoc, profile) {
    // A full-byte key avoids hash collisions between different profiles.
    const key = Array.from(profile, value => value.toString(16).padStart(2, '0')).join('');
    let profiles = profilesByDocument.get(pdfDoc);
    if (!profiles) { profiles = new Map(); profilesByDocument.set(pdfDoc, profiles); }
    if (!profiles.has(key)) profiles.set(key, pdfDoc.context.register(pdfDoc.context.flateStream(profile, { N: 3, Alternate: 'DeviceRGB' })));
    return profiles.get(key);
  }

  function getRasterProfile(pdfDoc, bytes, format, exportColorProfile, colorProfilePngData) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const metadata = format === 'PNG' ? pngProfile(pdfDoc, bytes) : format === 'JPG' ? jpegProfile(bytes) : invalid('unsupported raster format.');
    let profile = metadata.profile;
    let profileSource = profile ? 'embedded' : 'sRGB';
    // A legacy file's preferred profile is not exposed by the Plugin API.
    // Its tiny DOCUMENT PNG carries that metadata even when its JPEG does not.
    if (!profile && !metadata.isSRGB && format === 'JPG' && exportColorProfile === 'DOCUMENT' && colorProfilePngData) {
      const probeBytes = colorProfilePngData instanceof Uint8Array ? colorProfilePngData : new Uint8Array(colorProfilePngData);
      const probe = pngProfile(pdfDoc, probeBytes);
      profile = probe.profile || (probe.isSRGB ? sRGB : null);
      if (profile) profileSource = 'document-probe';
    }
    if (!profile) {
      if (exportColorProfile === 'DISPLAY_P3_V4') throw new Error('The Display P3 image is missing its ICC color profile.');
      if (exportColorProfile !== 'SRGB' && !metadata.isSRGB) throw new Error('The raster image color profile is unknown. Export with an explicit sRGB or Display P3 profile.');
      profile = sRGB;
    }
    return { profile, profileSource };
  }

  async function attachRasterProfile(pdfDoc, image, bytes, format, exportColorProfile, colorProfilePngData) {
    const { profile, profileSource } = getRasterProfile(pdfDoc, bytes, format, exportColorProfile, colorProfilePngData);
    await image.embed();
    const stream = pdfDoc.context.lookup(image.ref, PDFRawStream);
    if (stream.dict.get(PDFName.of('ColorSpace'))?.toString() !== '/DeviceRGB') invalid('the image must contain RGB pixels.');
    stream.dict.set(PDFName.of('ColorSpace'), pdfDoc.context.obj(['ICCBased', profileReference(pdfDoc, profile)]));
    return { profileSource, profileBytes: profile.length };
  }

  async function preserveNativeColorProfile(pdfDoc, source, sourcePage, copiedPage, exportColorProfile) {
    // copyPages recursively preserves ICCBased/DefaultRGB resources, including
    // nested shadings and image XObjects. Do not relabel or convert those colors.
    // Catalog-wide output intents are not copied by copyPages and cannot safely
    // be assigned to every page in a mixed-source document. Figma fixtures have
    // no OutputIntents. Unknown dependencies use the caller's raster fallback.
    const intents = source.catalog.get(PDFName.of('OutputIntents'));
    if (intents) {
      const list = source.context.lookup(intents, PDFArray);
      if (list.size()) throw new Error('This native PDF uses a document-wide output color profile; use a raster fallback to preserve its colors.');
    }
    return { profileSource: 'native-page-resources' };
  }

  return { attachRasterProfile, preserveNativeColorProfile, getRasterProfile };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createPdfColorManagement };
