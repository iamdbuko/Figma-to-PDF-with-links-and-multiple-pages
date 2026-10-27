// Downsample native PDF image XObjects without changing drawing commands, color
// profiles, page geometry or annotations. This deliberately supports a bounded
// PDF subset; unsupported content stays at its original resolution with a warning.
function createPdfImageResampler(P, options = {}) {
  const { PDFName: Name, PDFNumber: Num, PDFArray: Arr, PDFDict: Dict, PDFRawStream: Stream, PDFRef: Ref, PDFNull } = P;
  const n = Name.of;
  const decodeJpeg = options.decodeJpeg || (typeof require === 'function' ? require('jpeg-js').decode : globalThis.decodeCmykJpeg);
  const yieldToBrowser = options.yieldToBrowser || (() => new Promise(resolve => setTimeout(resolve, 0)));
  const MAX_PIXELS = 20000000, MAX_OUTPUT_PIXELS = 16000000, MAX_PAGE_PIXELS = 80000000, MAX_SIDE = 16384;
  const MAX_CONTENT = 16 * 1024 * 1024, MAX_ENCODED = 64 * 1024 * 1024, MAX_OUTPUT = 128 * 1024 * 1024;
  const operators = new Set('q Q cm w J j M d ri i m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 MP DP BMC BDC EMC BX EX Do sh gs CS cs SC SCN sc scn G g RG rg K k'.split(' '));
  const unsupported = message => { throw new Error(message); };
  const numeric = object => {
    if (!(object instanceof Num) || !Number.isFinite(object.asNumber())) unsupported('invalid numeric PDF data');
    return object.asNumber();
  };
  const matrixProduct = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
  ];

  function decodeFlate(stream, limit, exactSize = false) {
    if (!(stream instanceof Stream) || stream.contents.length > MAX_ENCODED) unsupported('an encoded stream exceeds the supported size');
    let filter = stream.dict.lookup(n('Filter'));
    if (filter instanceof Arr && filter.size() === 1) filter = filter.lookup(0);
    if (!filter || filter === PDFNull) {
      if (stream.contents.length > limit) unsupported('decoded data exceeds the supported size');
      return stream.contents;
    }
    if (!(filter instanceof Name) || filter.toString() !== '/FlateDecode') unsupported('an unsupported stream encoding');
    let parameters = stream.dict.lookup(n('DecodeParms'));
    if (parameters instanceof Arr && parameters.size() === 1) parameters = parameters.lookup(0);
    if (parameters && parameters !== PDFNull && (!(parameters instanceof Dict) ||
        (parameters.has(n('Predictor')) && numeric(parameters.lookup(n('Predictor'))) !== 1))) unsupported('predictor-coded data');
    const bytes = stream.contents;
    if (bytes.length < 6 || (bytes[0] & 15) !== 8 || (bytes[0] >> 4) > 7 || ((bytes[0] << 8) + bytes[1]) % 31 || (bytes[1] & 32)) unsupported('invalid Flate data');
    const dictionary = stream.dict.clone(); dictionary.set(n('Filter'), n('FlateDecode')); dictionary.delete(n('DecodeParms'));
    const decoder = P.decodePDFRawStream(Stream.of(dictionary, bytes)), ensure = decoder.ensureBuffer;
    if (typeof ensure !== 'function') unsupported('the bounded decoder is unavailable');
    decoder.ensureBuffer = function (requested) {
      if (requested > limit) unsupported('decoded data exceeds the supported size');
      // Image dimensions give an exact sample count. One allocation avoids the
      // decoder's geometric growth and overlapping superseded pixel buffers.
      if (exactSize) {
        if (this.buffer.length < limit) this.buffer = new Uint8Array(limit);
        return this.buffer;
      }
      return ensure.call(this, requested);
    };
    const decoded = decoder.decode();
    if (decoded.length > limit) unsupported('decoded data exceeds the supported size');
    let a = 1, b = 0;
    for (const byte of decoded) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const checksum = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
    if ((((b << 16) | a) >>> 0) !== checksum) unsupported('invalid Flate checksum');
    return decoded;
  }

  function parseContent(bytes, context) {
    const parser = P.PDFObjectParser.forBytes(bytes, context), input = parser.bytes;
    const result = [], operands = [];
    while (!input.done()) {
      parser.skipWhitespaceAndComments(); if (input.done()) break;
      const byte = input.peek();
      if ([43, 45, 46].includes(byte) || (byte >= 48 && byte <= 57)) {
        let token = '';
        while (!input.done() && /[+\-0-9.]/.test(String.fromCharCode(input.peek()))) token += String.fromCharCode(input.next());
        if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)$/.test(token) || !Number.isFinite(Number(token))) unsupported('invalid content numbers');
        operands.push(Num.of(Number(token)));
      } else if ([47, 40, 60, 91].includes(byte)) {
        const before = input.offset(); operands.push(parser.parseObject());
        if (input.offset() <= before) unsupported('invalid content operands');
      } else {
        let op = '';
        while (!input.done() && /[A-Za-z0-9*'"]/.test(String.fromCharCode(input.peek()))) op += String.fromCharCode(input.next());
        if (!operators.has(op)) unsupported(op === 'BI' ? 'inline images' : 'unsupported content instructions');
        result.push({ op, args: operands.splice(0) });
        if (result.length > 500000) unsupported('too many content instructions');
      }
      if (operands.length > 256) unsupported('too many content operands');
    }
    if (operands.length) unsupported('incomplete content instructions');
    return result;
  }

  async function resamplePage(doc, page, { dpi, stillActive = () => true } = {}) {
    if (!Number.isFinite(dpi) || dpi < 36 || dpi > 300) throw new Error('Image resolution must be between 36 and 300 DPI.');
    const context = doc.context, warnings = [], stats = { dpi, imagesFound: 0, imagesResampled: 0, imagesUnchanged: 0, sourcePixels: 0, outputPixels: 0, decodedPixels: 0, images: [] };
    const active = () => { if (!stillActive()) throw new Error('Image resolution adjustment was cancelled.'); };
    const warn = text => { if (!warnings.includes(text)) warnings.push(text); };
    const lookup = value => value instanceof Ref ? context.lookup(value) : value;
    const dictionary = value => { value = lookup(value); if (!(value instanceof Dict)) unsupported('invalid PDF resource dictionaries'); return value; };
    const list = value => { value = lookup(value); if (!(value instanceof Arr)) unsupported('invalid PDF arrays'); return value.asArray().map(value => numeric(lookup(value))); };
    const images = new Map(), protectedMasks = new Set(), contentCache = new Map(), activeForms = new Set();
    const protectedObjects = new Set();
    let contentBytes = 0, executed = 0, formUses = 0;
    const operations = stream => {
      stream = lookup(stream);
      if (!contentCache.has(stream)) {
        const bytes = decodeFlate(stream, MAX_CONTENT - contentBytes); contentBytes += bytes.length;
        contentCache.set(stream, parseContent(bytes, context));
      }
      return contentCache.get(stream);
    };
    const protectImageGraph = (value, depth = 0) => {
      value = lookup(value);
      if (!value || protectedObjects.has(value)) return;
      if (depth > 64 || protectedObjects.size >= 10000) unsupported('excessive protected image resources');
      protectedObjects.add(value);
      if (value instanceof Stream) {
        if (value.dict.get(n('Subtype'))?.toString() === '/Image') protectedMasks.add(value);
        protectImageGraph(value.dict, depth + 1);
      } else if (value instanceof Dict) {
        for (const child of value.values()) protectImageGraph(child, depth + 1);
      } else if (value instanceof Arr) {
        for (const child of value.asArray()) protectImageGraph(child, depth + 1);
      }
    };
    const protectForm = (form, resources) => {
      const before = protectedMasks.size;
      protectImageGraph(form);
      if (form instanceof Stream && !form.dict.has(n('Resources'))) protectImageGraph(resources);
      if (protectedMasks.size > before) warn('Images used by a transparency mask or pattern were kept at their original resolution.');
    };
    const verifySoftGraphicsState = (state, resources) => {
      const mask = state.lookup(n('SMask'));
      if (!mask || mask.toString() === '/None') return;
      if (!(mask instanceof Dict) || !['/Alpha', '/Luminosity'].includes(mask.get(n('S'))?.toString())) unsupported('unknown transparency-group soft masks');
      const group = mask.lookup(n('G'));
      if (!(group instanceof Stream)) unsupported('invalid transparency-group soft masks');
      // A soft mask is evaluated in a separate transparency context. Preserve
      // its complete resource graph rather than infer its effective image DPI.
      protectForm(group, resources);
    };
    const checkFont = (resources, name) => {
      const fonts = resources.lookup(n('Font'));
      const font = fonts instanceof Dict ? fonts.lookup(name) : null;
      if (!(font instanceof Dict) || font.get(n('Subtype'))?.toString() !== '/Type3') return;
      for (const value of dictionary(font.get(n('CharProcs'))).values()) {
        const ops = operations(value);
        if (ops.length !== 1 || ops[0].op !== 'd1') unsupported('painted Type3 fonts');
      }
    };
    const rememberImage = (ref, image, resources, matrix) => {
      if (!(ref instanceof Ref)) { warn('A directly stored image was kept at its original resolution.'); return; }
      let item = images.get(image);
      if (!item) { item = { image, refs: new Map(), uses: [], scale: 0 }; images.set(image, item); }
      item.refs.set(ref.toString(), ref); item.uses.push({ resources, matrix: matrix.slice() });
      for (const key of ['SMask', 'Mask']) {
        const mask = lookup(image.dict.get(n(key))); if (mask instanceof Stream) protectedMasks.add(mask);
      }
    };
    async function walk(streams, resources, initialMatrix, depth = 0) {
      if (depth > 32) unsupported('deeply nested Form XObjects');
      resources = dictionary(resources);
      let matrix = initialMatrix.slice(); const stack = [];
      for (const stream of streams) for (const { op, args } of operations(stream)) {
        if (++executed > 500000) unsupported('too many executed drawing instructions');
        if (op === 'q') { if (stack.length >= 128) unsupported('deeply nested graphics state'); stack.push(matrix.slice()); }
        else if (op === 'Q') { if (!stack.length) unsupported('unbalanced graphics state'); matrix = stack.pop(); }
        else if (op === 'cm') {
          if (args.length !== 6) unsupported('invalid drawing transforms');
          matrix = matrixProduct(matrix, args.map(numeric));
          if (!matrix.every(Number.isFinite)) unsupported('non-finite drawing transforms');
        } else if (op === 'Do') {
          if (args.length !== 1 || !(args[0] instanceof Name)) unsupported('invalid image placement');
          const objects = resources.lookup(n('XObject'));
          const ref = objects instanceof Dict ? objects.get(args[0]) : null, object = lookup(ref);
          if (!(object instanceof Stream)) unsupported('missing drawing resources');
          const type = object.dict.get(n('Subtype'))?.toString();
          if (type === '/Image') rememberImage(ref, object, resources, matrix);
          else if (type === '/Form') {
            if (++formUses > 2048 || activeForms.has(object)) unsupported('recursive or excessive Form XObjects');
            if (object.dict.has(n('Ref')) || object.dict.has(n('OPI'))) unsupported('external Form XObjects');
            const formMatrix = object.dict.has(n('Matrix')) ? list(object.dict.get(n('Matrix'))) : [1, 0, 0, 1, 0, 0];
            if (formMatrix.length !== 6) unsupported('invalid Form transforms');
            activeForms.add(object);
            await walk([object], object.dict.get(n('Resources')) || resources, matrixProduct(matrix, formMatrix), depth + 1);
            activeForms.delete(object);
          } else unsupported('unsupported XObject types');
        } else if (op === 'gs') {
          if (args.length !== 1 || !(args[0] instanceof Name)) unsupported('invalid graphics state');
          const states = resources.lookup(n('ExtGState'));
          if (!(states instanceof Dict)) unsupported('missing graphics state');
          verifySoftGraphicsState(dictionary(states.get(args[0])), resources);
        } else if (op === 'Tf' && args[0] instanceof Name) checkFont(resources, args[0]);
        else if (['scn', 'SCN'].includes(op) && args.at(-1) instanceof Name) {
          const patterns = resources.lookup(n('Pattern')), pattern = patterns instanceof Dict ? patterns.lookup(args.at(-1)) : null;
          if (pattern instanceof Stream && numeric(pattern.dict.lookup(n('PatternType'))) === 1) {
            protectForm(pattern, resources);
          } else {
            if (!(pattern instanceof Dict) || numeric(pattern.lookup(n('PatternType'))) !== 2) unsupported('unknown patterns');
            if (pattern.has(n('ExtGState'))) verifySoftGraphicsState(dictionary(pattern.get(n('ExtGState'))), resources);
          }
        }
        if (executed % 4096 === 0) { await yieldToBrowser(); active(); }
      }
      if (stack.length) unsupported('unbalanced graphics state');
    }

    active();
    try {
      const annots = page.node.lookupMaybe(n('Annots'), Arr);
      if (annots) for (const ref of annots.asArray()) if (dictionary(ref).has(n('AP'))) unsupported('annotation appearance streams');
      const contents = page.node.lookup(n('Contents'));
      if (!contents) return { warnings, stats };
      const unit = page.node.has(n('UserUnit')) ? numeric(page.node.lookup(n('UserUnit'))) : 1;
      if (unit <= 0) unsupported('invalid page units');
      await walk(contents instanceof Arr ? contents.asArray() : [contents], page.node.Resources(), [unit, 0, 0, unit, 0, 0]);
    } catch (error) {
      active();
      warn(`Image resolution was unchanged on this page because of ${error.message || error}.`);
      return { warnings, stats: { ...stats, pageUnchanged: true } };
    }
    stats.imagesFound = images.size;
    const staged = [];
    let stagedBytes = 0;
    for (const item of images.values()) {
      active();
      const { image } = item, d = image.dict;
      let width, height, targetWidth, targetHeight;
      try {
        width = numeric(d.lookup(n('Width'))); height = numeric(d.lookup(n('Height')));
        if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= MAX_SIDE)) unsupported('source image dimensions above 16,384 pixels per side or invalid dimensions');
        stats.sourcePixels += width * height;
        if (width * height > MAX_PIXELS) unsupported('source images above 20 million pixels');
        // The largest singular value of the source-pixel-to-page transform
        // conservatively handles rotation, skew and repeated image placements.
        for (const use of item.uses) {
          const [a, b, c, e] = use.matrix;
          const x = (a * a + b * b) / (width * width), z = (c * c + e * e) / (height * height), y = (a * c + b * e) / (width * height);
          const density = Math.sqrt(Math.max(0, (x + z + Math.hypot(x - z, 2 * y)) / 2));
          if (!Number.isFinite(density)) unsupported('extreme drawing transforms');
          item.scale = Math.max(item.scale, density * dpi / 72);
        }
        const scale = Math.min(1, item.scale);
        targetWidth = Math.max(1, Math.min(width, Math.ceil(width * scale)));
        targetHeight = Math.max(1, Math.min(height, Math.ceil(height * scale)));
        if (width === targetWidth && height === targetHeight) {
          stats.imagesUnchanged++; stats.outputPixels += width * height;
          stats.images.push({ width, height, targetWidth, targetHeight, resized: false }); continue;
        }
        if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) unsupported('resized images above 16 million pixels; choose a lower image resolution');
        if (protectedMasks.has(image)) unsupported('an image also used as another image’s mask');
        if (d.get(n('ImageMask'))?.toString() === 'true' || numeric(d.lookup(n('BitsPerComponent'))) !== 8) unsupported('stencil or non-8-bit images');
        for (const key of ['Mask', 'Matte', 'Alternates', 'SMaskInData']) if (d.has(n(key))) unsupported(`image ${key}`);
        const componentsFor = (value, resources, seen = new Set()) => {
          value = lookup(value); if (seen.has(value)) unsupported('recursive image color spaces'); seen.add(value);
          if (value instanceof Name) {
            const key = value.toString();
            if (key === '/DeviceRGB') return 3;
            if (key === '/DeviceGray') return 1;
            const spaces = resources.lookup(n('ColorSpace'));
            if (!(spaces instanceof Dict) || !spaces.has(value)) unsupported('unsupported image color spaces');
            return componentsFor(spaces.get(value), resources, seen);
          }
          if (value instanceof Arr && value.get(0)?.toString() === '/ICCBased') {
            const profile = lookup(value.get(1));
            if (!(profile instanceof Stream)) unsupported('invalid ICC color spaces');
            const count = numeric(profile.dict.lookup(n('N')));
            if (count === 1 || count === 3) return count;
          }
          unsupported('unsupported image color spaces');
        };
        const componentCounts = item.uses.map(use => componentsFor(d.get(n('ColorSpace')), use.resources));
        if (new Set(componentCounts).size !== 1) unsupported('context-dependent image channel counts');
        const components = componentCounts[0];
        if (d.has(n('Decode'))) {
          const decode = list(d.get(n('Decode')));
          if (decode.length !== components * 2 || decode.some((value, index) => value !== index % 2)) unsupported('custom image Decode ranges');
        }
        if (stats.decodedPixels + width * height > MAX_PAGE_PIXELS) unsupported('the 80 million decoded image pixels per page limit');
        stats.decodedPixels += width * height;
        let alpha = null, originalMask = null;
        if (d.has(n('SMask'))) {
          originalMask = lookup(d.get(n('SMask')));
          if (!(originalMask instanceof Stream) || originalMask.dict.get(n('Subtype'))?.toString() !== '/Image') unsupported('complex image soft masks');
          const md = originalMask.dict;
          if (numeric(md.lookup(n('Width'))) !== width || numeric(md.lookup(n('Height'))) !== height || numeric(md.lookup(n('BitsPerComponent'))) !== 8 || md.get(n('ColorSpace'))?.toString() !== '/DeviceGray') unsupported('nonmatching or non-gray soft masks');
          for (const key of ['Matte', 'Decode', 'SMask', 'Mask']) if (md.has(n(key))) unsupported(`soft-mask ${key}`);
          alpha = decodeFlate(originalMask, width * height, true);
          if (alpha.length !== width * height) unsupported('incomplete soft-mask samples');
        }
        let filter = d.lookup(n('Filter')); if (filter instanceof Arr && filter.size() === 1) filter = filter.lookup(0);
        let samples;
        if (filter?.toString() === '/DCTDecode') {
          if (!decodeJpeg || image.contents.length > MAX_ENCODED) unsupported('unavailable or oversized JPEG decoding');
          const params = d.lookup(n('DecodeParms')); if (params && params !== PDFNull) unsupported('custom JPEG decoding parameters');
          const decoded = decodeJpeg(image.contents, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 20, maxMemoryUsageInMB: 256 });
          if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 3) unsupported('JPEG dimensions that differ from the image dictionary');
          samples = decoded.data;
          if (components === 1) {
            const gray = new Uint8Array(width * height);
            for (let i = 0; i < gray.length; i++) {
              if (samples[i * 3] !== samples[i * 3 + 1] || samples[i * 3] !== samples[i * 3 + 2]) unsupported('non-gray decoded samples in a gray JPEG');
              gray[i] = samples[i * 3];
            }
            samples = gray;
          }
        } else samples = decodeFlate(image, width * height * components, true);
        if (samples.length !== width * height * components) unsupported('incomplete image samples');
        active();
        const resized = await areaResize(samples, alpha, width, height, targetWidth, targetHeight, components, active);
        const replacement = context.flateStream(resized.samples), mask = originalMask ? context.flateStream(resized.alpha) : null;
        for (const [key, value] of d.entries()) if (!['Length', 'Filter', 'DecodeParms', 'Width', 'Height', 'SMask'].includes(key.decodeText())) replacement.dict.set(key, value);
        replacement.dict.set(n('Width'), Num.of(targetWidth)); replacement.dict.set(n('Height'), Num.of(targetHeight));
        if (mask) {
          for (const [key, value] of originalMask.dict.entries()) if (!['Length', 'Filter', 'DecodeParms', 'Width', 'Height'].includes(key.decodeText())) mask.dict.set(key, value);
          mask.dict.set(n('Width'), Num.of(targetWidth)); mask.dict.set(n('Height'), Num.of(targetHeight));
        }
        const outputBytes = replacement.contents.length + (mask?.contents.length || 0);
        if (stagedBytes + outputBytes > MAX_OUTPUT) unsupported('the 128 MiB resized-image data limit');
        stagedBytes += outputBytes;
        staged.push({ item, replacement, mask, width, height, targetWidth, targetHeight });
      } catch (error) {
        active();
        stats.imagesUnchanged++;
        if (Number.isFinite(width) && Number.isFinite(height)) stats.outputPixels += width * height;
        stats.images.push({ width, height, resized: false, reason: String(error.message || error) });
        warn(`An embedded image was kept at its original resolution because of ${error.message || error}.`);
      }
      await yieldToBrowser(); active();
    }
    // No PDF resources are changed until all asynchronous work has settled.
    active();
    for (const entry of staged) {
      const { item, replacement, mask, width, height, targetWidth, targetHeight } = entry;
      if (mask) replacement.dict.set(n('SMask'), context.register(mask));
      for (const ref of item.refs.values()) context.assign(ref, replacement);
      stats.imagesResampled++; stats.outputPixels += targetWidth * targetHeight;
      stats.images.push({ width, height, targetWidth, targetHeight, resized: true });
    }
    return { warnings, stats };
  }

  async function areaResize(samples, alpha, width, height, outWidth, outHeight, components, active) {
    const output = new Uint8Array(outWidth * outHeight * components), outAlpha = alpha ? new Uint8Array(outWidth * outHeight) : null;
    const scaleX = width / outWidth, scaleY = height / outHeight, area = scaleX * scaleY;
    let work = 0;
    for (let oy = 0; oy < outHeight; oy++) {
      const y0 = oy * scaleY, y1 = (oy + 1) * scaleY;
      for (let ox = 0; ox < outWidth; ox++) {
        const x0 = ox * scaleX, x1 = (ox + 1) * scaleX;
        let red = 0, green = 0, blue = 0, weight = 0;
        for (let sy = Math.floor(y0); sy < Math.min(height, Math.ceil(y1)); sy++) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          for (let sx = Math.floor(x0); sx < Math.min(width, Math.ceil(x1)); sx++) {
            const pixel = sy * width + sx;
            const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (alpha ? alpha[pixel] / 255 : 1);
            weight += w; red += samples[pixel * components] * w;
            if (components === 3) { green += samples[pixel * 3 + 1] * w; blue += samples[pixel * 3 + 2] * w; }
            if (++work % 262144 === 0) { await yieldToBrowser(); active(); }
          }
        }
        const pixel = oy * outWidth + ox;
        if (weight > 0) {
          output[pixel * components] = Math.round(red / weight);
          if (components === 3) { output[pixel * 3 + 1] = Math.round(green / weight); output[pixel * 3 + 2] = Math.round(blue / weight); }
        }
        if (outAlpha) outAlpha[pixel] = Math.round(weight / area * 255);
      }
      if (oy % 32 === 31) { await yieldToBrowser(); active(); }
    }
    active(); return { samples: output, alpha: outAlpha };
  }
  return { resamplePage };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createPdfImageResampler };
