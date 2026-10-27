// Experimental raster CMYK: an uploaded printer ICC, LittleCMS relative
// colorimetric conversion with black-point compensation, and opaque white paper.
// This does not make the surrounding PDF a PDF/X document or a press proof.
function createCmykExporter(PDFLib, options = {}) {
  const MAX_PROFILE_BYTES = 16 * 1024 * 1024;
  const MAX_PIXELS = 8000000;
  const MAX_SIDE = 16384;
  const CHUNK_PIXELS = Math.min(65536, Math.max(1, options.chunkPixels || 65536));
  const loadEngine = options.loadEngine || (() => globalThis.loadCmykEngine());
  const yieldToBrowser = options.yieldToBrowser || (() => new Promise(resolve => setTimeout(resolve, 0)));
  let getRasterProfile = options.getRasterProfile;
  if (!getRasterProfile) {
    const factory = typeof createPdfColorManagement === 'function' ? createPdfColorManagement
      : typeof require === 'function' ? require('./color-profiles.js').createPdfColorManagement : null;
    if (!factory) throw new Error('The raster color-profile reader is unavailable.');
    getRasterProfile = factory(PDFLib).getRasterProfile;
  }

  const text = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bytesKey = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

  function validatePrinterProfile(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 132 || bytes.length > MAX_PROFILE_BYTES) throw new Error('Choose a CMYK printer ICC profile between 132 bytes and 16 MiB.');
    const data = view(bytes);
    if (data.getUint32(0) !== bytes.length || text(bytes, 36, 4) !== 'acsp' || ![2, 4].includes(bytes[8])) throw new Error('The CMYK ICC profile has an invalid or unsupported header.');
    if (text(bytes, 12, 4) !== 'prtr' || text(bytes, 16, 4) !== 'CMYK' || !['Lab ', 'XYZ '].includes(text(bytes, 20, 4))) throw new Error('Upload a CMYK output/printer ICC profile, not an RGB profile or device link.');
    const count = data.getUint32(128), signatures = new Set();
    if (!count || count > 4096 || 132 + count * 12 > bytes.length) throw new Error('The CMYK ICC profile has an invalid tag table.');
    for (let index = 0; index < count; index++) {
      const offset = 132 + index * 12, tag = text(bytes, offset, 4);
      const start = data.getUint32(offset + 4), length = data.getUint32(offset + 8);
      if (signatures.has(tag) || start % 4 || start < 132 + count * 12 || length < 8 || start + length > bytes.length) throw new Error('A CMYK ICC tag is duplicated or outside the profile.');
      signatures.add(tag);
    }
    if (!signatures.has('B2A0') && !signatures.has('B2A1')) throw new Error('This CMYK ICC profile cannot convert RGB colors into printer colors.');
    if (!signatures.has('A2B0') && !signatures.has('A2B1')) throw new Error('This CMYK ICC profile cannot describe its printer colors for PDF rendering.');
    return bytes.slice();
  }

  function pngDimensions(bytes) {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) || text(bytes, 12, 4) !== 'IHDR' || view(bytes).getUint32(8) !== 13) throw new Error('CMYK conversion requires a valid sRGB PNG export.');
    const data = view(bytes), width = data.getUint32(16), height = data.getUint32(20);
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error('Experimental CMYK supports up to 8 million pixels per page. Lower the raster quality or enable fitting oversized pages.');
    return { width, height };
  }

  async function prepare(input) {
    let profileBytes = validatePrinterProfile(input);
    const { lcms, constants } = await loadEngine();
    const flags = constants.cmsFLAGS_BLACKPOINTCOMPENSATION | constants.cmsFLAGS_NOCACHE;
    const intent = constants.INTENT_RELATIVE_COLORIMETRIC;
    const transforms = new Map(), profileRefs = new WeakMap();
    let outputProfile = 0, profilePointer = 0, inputPointer = 0, outputPointer = 0;
    let closed = false, busy = false;

    function allocate(size) {
      const pointer = lcms._malloc(size);
      if (!pointer) throw new Error('The CMYK engine could not allocate its working memory.');
      return pointer;
    }

    function openProfile(bytes) {
      const pointer = allocate(bytes.length);
      lcms.HEAPU8.set(bytes, pointer);
      let handle = 0;
      try {
        // The package's convenience wrapper uses the WASM stack for arrays.
        // Large printer profiles must use heap storage, retained until close.
        handle = lcms._cmsOpenProfileFromMem(pointer, bytes.length);
        if (!handle) throw new Error('LittleCMS could not read this ICC profile.');
        return { handle, pointer };
      } catch (error) { lcms._free(pointer); throw error; }
    }

    function makeTransform(source, sixteen = false) {
      const transform = lcms.cmsCreateTransform(source, sixteen ? constants.TYPE_RGB_16 : constants.TYPE_RGB_8, outputProfile, sixteen ? constants.TYPE_CMYK_16 : constants.TYPE_CMYK_8, intent, flags);
      if (!transform) throw new Error('This printer profile does not provide a usable RGB-to-CMYK conversion.');
      return transform;
    }

    function close() {
      if (closed) return;
      closed = true;
      try { for (const transform of transforms.values()) lcms.cmsDeleteTransform(transform); }
      finally {
        transforms.clear();
        try { if (outputProfile) lcms.cmsCloseProfile(outputProfile); }
        finally {
          outputProfile = 0;
          for (const pointer of [profilePointer, inputPointer, outputPointer]) if (pointer) lcms._free(pointer);
          profilePointer = inputPointer = outputPointer = 0;
          profileBytes = null;
        }
      }
    }

    function active(stillActive) {
      if (closed || !stillActive()) throw new Error('CMYK conversion was cancelled.');
    }

    function transformFor(sourceBytes, sixteen = false) {
      const key = `${sixteen ? 16 : 8}:${bytesKey(sourceBytes)}`;
      if (transforms.has(key)) return transforms.get(key);
      if (transforms.size >= 16) throw new Error('This CMYK export contains too many different RGB source profiles.');
      const source = openProfile(sourceBytes);
      try {
        if (lcms.cmsGetColorSpaceASCII(source.handle) !== 'RGB') throw new Error('The CMYK source profile must describe RGB pixels.');
        const transform = makeTransform(source.handle, sixteen);
        transforms.set(key, transform);
        return transform;
      } finally { lcms.cmsCloseProfile(source.handle); lcms._free(source.pointer); }
    }

    function destinationProfileRef(pdfDoc) {
      active(() => true);
      if (!profileRefs.has(pdfDoc)) profileRefs.set(pdfDoc, pdfDoc.context.register(pdfDoc.context.flateStream(profileBytes, { N: 4, Alternate: 'DeviceCMYK' })));
      return profileRefs.get(pdfDoc);
    }

    // Vector operands and gradient samples use 16-bit transforms to avoid an
    // unnecessary 8-bit quantization before the final PDF color values.
    async function convertColors(values, sourceBytes, { stillActive = () => true } = {}) {
      active(stillActive);
      if (busy) throw new Error('CMYK conversions must run one at a time.');
      if (!values || values.length % 3 || values.length > MAX_PIXELS * 3) throw new Error('Invalid RGB color samples.');
      busy = true;
      try {
        const transform = transformFor(sourceBytes, true);
        const result = new Float64Array(values.length / 3 * 4);
        for (let offset = 0; offset < values.length / 3; offset += CHUNK_PIXELS) {
          active(stillActive);
          const count = Math.min(CHUNK_PIXELS, values.length / 3 - offset);
          const input = new Uint16Array(lcms.HEAPU8.buffer, inputPointer, count * 3);
          for (let i = 0; i < input.length; i++) {
            const value = values[offset * 3 + i];
            if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid RGB color value.');
            input[i] = Math.round(value * 65535);
          }
          lcms._cmsDoTransform(transform, inputPointer, outputPointer, count);
          const output = new Uint16Array(lcms.HEAPU8.buffer, outputPointer, count * 4);
          for (let i = 0; i < output.length; i++) result[offset * 4 + i] = output[i] / 65535;
          await yieldToBrowser();
        }
        active(stillActive);
        return result;
      } finally { busy = false; }
    }

    async function convertRgb8(rgb, sourceBytes, { stillActive = () => true } = {}) {
      active(stillActive);
      if (busy) throw new Error('CMYK conversions must run one at a time.');
      if (!(rgb instanceof Uint8Array) || rgb.length % 3 || rgb.length > 16000000 * 3) throw new Error('Vector CMYK supports embedded images up to 16 million pixels.');
      busy = true;
      try {
        const transform = transformFor(sourceBytes), count = rgb.length / 3;
        const result = new Uint8Array(count * 4);
        for (let offset = 0; offset < count; offset += CHUNK_PIXELS) {
          active(stillActive);
          const chunk = Math.min(CHUNK_PIXELS, count - offset);
          lcms.HEAPU8.set(rgb.subarray(offset * 3, (offset + chunk) * 3), inputPointer);
          lcms._cmsDoTransform(transform, inputPointer, outputPointer, chunk);
          result.set(lcms.HEAPU8.subarray(outputPointer, outputPointer + chunk * 4), offset * 4);
          await yieldToBrowser();
        }
        active(stillActive);
        return result;
      } finally { busy = false; }
    }

    async function embedPng(pdfDoc, inputBytes, { stillActive = () => true } = {}) {
      active(stillActive);
      if (busy) throw new Error('CMYK pages must be converted one at a time.');
      busy = true;
      let decoded = null, rgb = null, alpha = null, cmyk = null;
      try {
        const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
        const dimensions = pngDimensions(bytes);
        const source = getRasterProfile(pdfDoc, bytes, 'PNG', 'SRGB');
        if (!source?.profile) throw new Error('The sRGB source profile is unavailable.');
        const transform = transformFor(source.profile);
        active(stillActive);
        // The pinned PNG decoder exposes RGB/alpha without canvas color conversion.
        // Decoding is whole-page; the separate8 MP cap bounds this allocation.
        decoded = await PDFLib.PngEmbedder.for(bytes);
        if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new Error('Decoded PNG dimensions differ from its header.');
        rgb = decoded.image.rgbChannel; alpha = decoded.image.alphaChannel || null;
        const count = dimensions.width * dimensions.height;
        if (rgb.length !== count * 3 || (alpha && alpha.length !== count)) throw new Error('The PNG pixel data is incomplete.');
        await yieldToBrowser();
        active(stillActive);
        cmyk = new Uint8Array(count * 4);
        for (let offset = 0; offset < count; offset += CHUNK_PIXELS) {
          active(stillActive);
          const chunk = Math.min(CHUNK_PIXELS, count - offset);
          const heap = lcms.HEAPU8;
          if (!alpha) heap.set(rgb.subarray(offset * 3, (offset + chunk) * 3), inputPointer);
          else for (let pixel = 0; pixel < chunk; pixel++) {
            const a = alpha[offset + pixel], sourceOffset = (offset + pixel) * 3, target = inputPointer + pixel * 3;
            // Flatten straight sRGB alpha onto white paper before CMYK conversion.
            for (let channel = 0; channel < 3; channel++) heap[target + channel] = Math.round((rgb[sourceOffset + channel] * a + 255 * (255 - a)) / 255);
          }
          lcms._cmsDoTransform(transform, inputPointer, outputPointer, chunk);
          cmyk.set(lcms.HEAPU8.subarray(outputPointer, outputPointer + chunk * 4), offset * 4);
          await yieldToBrowser();
        }
        decoded = rgb = alpha = null;
        active(stillActive);
        const stream = pdfDoc.context.flateStream(cmyk, {
          Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8,
          Width: dimensions.width, Height: dimensions.height,
          ColorSpace: ['ICCBased', destinationProfileRef(pdfDoc)]
        });
        cmyk = null;
        const ref = pdfDoc.context.register(stream);
        // PDFImage's pinned implementation accepts only its built-in embedder
        // classes. Supply a lightweight PngEmbedder shell whose stream is already
        // registered; it contains no PNG pixels and performs no RGB re-embedding.
        const embedder = new PDFLib.PngEmbedder({ ...dimensions, bitsPerComponent: 8 });
        embedder.embedIntoContext = async () => ref;
        const image = PDFLib.PDFImage.of(ref, pdfDoc, embedder);
        await image.embed();
        active(stillActive);
        return { image, ...dimensions };
      } finally { decoded = rgb = alpha = cmyk = null; busy = false; }
    }

    try {
      const opened = openProfile(profileBytes);
      outputProfile = opened.handle; profilePointer = opened.pointer;
      if (lcms.cmsGetColorSpaceASCII(outputProfile) !== 'CMYK') throw new Error('The uploaded printer profile is not CMYK.');
      const probeSource = lcms.cmsCreate_sRGBProfile();
      if (!probeSource) throw new Error('The CMYK engine could not create its sRGB test profile.');
      let probe = 0, reverseProbe = 0;
      try {
        probe = makeTransform(probeSource);
        reverseProbe = lcms.cmsCreateTransform(outputProfile, constants.TYPE_CMYK_8, probeSource, constants.TYPE_RGB_8, intent, flags);
        if (!reverseProbe) throw new Error('This printer profile cannot describe CMYK colors for PDF rendering.');
      } finally {
        if (probe) lcms.cmsDeleteTransform(probe);
        if (reverseProbe) lcms.cmsDeleteTransform(reverseProbe);
        lcms.cmsCloseProfile(probeSource);
      }
      inputPointer = allocate(CHUNK_PIXELS * 6);
      outputPointer = allocate(CHUNK_PIXELS * 8);
      const rawName = lcms.cmsGetProfileInfoASCII(outputProfile, constants.cmsInfoDescription, 'en', 'US');
      const profileName = String(rawName || 'CMYK printer profile').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160);
      return { embedPng, convertColors, convertRgb8, destinationProfileRef, close, profileName, renderingIntent: 'relative-colorimetric', blackPointCompensation: true, maxPixels: MAX_PIXELS };
    } catch (error) { close(); throw error; }
  }

  return { prepare };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createCmykExporter };
