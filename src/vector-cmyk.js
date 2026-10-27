// Vector CMYK beta for native Figma PDFs. This is a bounded PDF subset, not a
// general prepress interpreter. Unsupported constructs fail before download.
function createVectorCmykConverter(P, options = {}) {
  const { PDFName: Name, PDFDict: Dict, PDFArray: Arr, PDFRawStream: Stream, PDFNumber: Num } = P;
  const n = Name.of, fail = message => { throw new Error(`Vector CMYK: ${message} Choose Rasterized for this page.`); };
  const decodeJpeg = options.decodeJpeg || (typeof require === 'function' ? require('jpeg-js').decode : globalThis.decodeCmykJpeg);
  const functionFactory = typeof createPdfFunctionEvaluator === 'function' ? createPdfFunctionEvaluator
    : typeof require === 'function' ? require('./pdf-functions').createPdfFunctionEvaluator : null;
  const sRGB = Uint8Array.from(atob(typeof PDF_EXPORT_SRGB_ICC === 'string' ? PDF_EXPORT_SRGB_ICC
    : typeof require === 'function' ? require('./color-profiles').PDF_EXPORT_SRGB_ICC : ''), c => c.charCodeAt(0));
  const MAX_STREAM = 64 * 1024 * 1024, MAX_CONTENT = 16 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 16000000, MAX_PAGE_PIXELS = 32000000;
  const allowed = new Set('q Q cm w J j M d ri i m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " d0 d1 MP DP BMC BDC EMC BX EX Do sh gs CS cs SC SCN sc scn G g RG rg K k'.split(' '));
  const number = v => { if (!(v instanceof Num) || !Number.isFinite(v.asNumber())) fail('Invalid numeric operand.'); return v.asNumber(); };
  const format = value => { if (!Number.isFinite(value)) fail('Invalid converted color.'); return Number(value.toFixed(6)).toString(); };
  const adjacent = (value, up) => {
    if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
    const data = new DataView(new ArrayBuffer(8)); data.setFloat64(0, value);
    const bits = data.getBigUint64(0);
    data.setBigUint64(0, bits + ((value > 0) === up ? 1n : -1n));
    return data.getFloat64(0);
  };

  function boundedDecode(stream, limit = MAX_STREAM, limitMessage = 'A decompressed PDF stream is too large.') {
    if (!(stream instanceof Stream)) fail('Unsupported PDF stream.');
    const filter = stream.dict.lookup(n('Filter'));
    const filters = filter instanceof Arr ? filter.asArray().map(String) : filter ? [String(filter)] : [];
    if (filters.length > 1 || filters.some(f => f !== '/FlateDecode')) fail('Unsupported compressed PDF stream.');
    const params = stream.dict.lookup(n('DecodeParms'));
    const param = params instanceof Arr ? params.lookup(0) : params;
    if (param instanceof Dict && param.lookup(n('Predictor'))?.asNumber() > 1) fail('Predictor-coded images are not supported yet.');
    const decoder = P.decodePDFRawStream(stream);
    if (typeof decoder.ensureBuffer === 'function') {
      const ensure = decoder.ensureBuffer;
      decoder.ensureBuffer = function (size) { if (size > limit) fail(limitMessage); return ensure.call(this, size); };
    }
    const bytes = decoder.decode();
    if (bytes.length > limit) fail(limitMessage);
    return bytes;
  }

  // Parse operands with pdf-lib's pinned object parser; retain all non-color
  // operands verbatim through its serializer. Inline images are never guessed.
  function operations(bytes, context) {
    const parser = P.PDFObjectParser.forBytes(bytes, context), input = parser.bytes;
    const result = [], operands = [];
    while (!input.done()) {
      parser.skipWhitespaceAndComments();
      if (input.done()) break;
      const b = input.peek();
      if ([43, 45, 46].includes(b) || (b >= 48 && b <= 57)) {
        // Content numbers are never indirect references. The object parser
        // would otherwise misread adjacent numbers followed by RG as an R ref.
        let token = '';
        while (!input.done() && /[+\-0-9.]/.test(String.fromCharCode(input.peek()))) token += String.fromCharCode(input.next());
        if (!/^[+\-]?(?:\d+\.?\d*|\.\d+)$/.test(token) || !Number.isFinite(Number(token))) fail('Invalid PDF number.');
        operands.push(Num.of(Number(token)));
        if (operands.length > 256) fail('Invalid PDF operand list.');
      } else if ([47, 40, 60, 91].includes(b)) {
        const before = input.offset();
        operands.push(parser.parseObject());
        if (input.offset() <= before || operands.length > 256) fail('Invalid PDF operand list.');
      } else {
        let op = '';
        while (!input.done() && /[A-Za-z0-9*'"]/.test(String.fromCharCode(input.peek()))) op += String.fromCharCode(input.next());
        if (!op || !allowed.has(op)) fail(`Unsupported PDF instruction ${op || b}.`);
        result.push({ op, args: operands.splice(0) });
        if (result.length > 500000) fail('This page has too many PDF instructions.');
      }
    }
    if (operands.length) fail('Incomplete PDF instruction.');
    return result;
  }

  async function convertPage(doc, page, session, { stillActive = () => true } = {}) {
    const ctx = doc.context, stats = { colors: 0, images: 0, imagePixels: 0, gradients: 0, forms: 0 };
    const active = () => { if (!stillActive()) throw new Error('Vector CMYK conversion was cancelled.'); };
    active();
    if (!session?.convertColors || !session?.convertRgb8 || !session?.destinationProfileRef || sRGB.length < 132 || !functionFactory) fail('The vector conversion engine is unavailable.');
    if (doc.catalog.lookup(n('OutputIntents'))?.size()) fail('Document-wide output profiles are not supported.');
    const target = ctx.obj(['ICCBased', session.destinationProfileRef(doc)]);
    const profileCache = new WeakMap(), resourceCache = new WeakMap(), objectCache = new WeakMap();
    const inProgress = new WeakSet(), colorCache = new Map();
    const checkedForms = new WeakMap();
    let contentBytes = 0, instructionCount = 0, resourceCount = 0, hasTransparency = false, approximateGradient = false;
    const evaluator = functionFactory(P);
    const lookup = value => ctx.lookup(value);
    const dict = value => { value = lookup(value); if (!(value instanceof Dict)) fail('Invalid PDF resource dictionary.'); return value; };
    const array = value => { value = lookup(value); if (!(value instanceof Arr)) fail('Invalid PDF array.'); return value.asArray().map(v => number(lookup(v))); };
    const count = (d, key) => number(d.lookup(n(key)));
    const defaultRGB = { kind: 'rgb', components: 3, profile: sRGB };
    const gray = { kind: 'gray', components: 1, profile: sRGB };
    // The same object can inherit a different DefaultRGB or named color space
    // in another resource dictionary. Cache only within that exact scope.
    const cachedObject = (object, resources) => objectCache.get(object)?.get(resources);
    const cacheObject = (object, resources, result) => {
      if (!objectCache.has(object)) objectCache.set(object, new WeakMap());
      objectCache.get(object).set(resources, result); return result;
    };
    const readContent = stream => {
      const remaining = MAX_CONTENT - contentBytes;
      if (remaining <= 0) fail('The page drawing instructions exceed 16 MiB.');
      const bytes = boundedDecode(stream, remaining, 'The page drawing instructions exceed 16 MiB.');
      contentBytes += bytes.length + 1;
      if (contentBytes > MAX_CONTENT) fail('The page drawing instructions exceed 16 MiB.');
      return bytes;
    };
    const parseOperations = bytes => {
      const result = operations(bytes, ctx); instructionCount += result.length;
      if (instructionCount > 500000) fail('This page has too many PDF instructions.');
      return result;
    };
    const formOperations = new WeakMap();
    function formOps(form) {
      if (!formOperations.has(form)) formOperations.set(form, parseOperations(readContent(form)));
      return formOperations.get(form);
    }
    function validateFormGraph(form, inherited, ancestors = new Set()) {
      if (ancestors.has(form)) fail('Recursive Form XObjects are not supported.');
      if (ancestors.size >= 32) fail('Form XObjects are nested too deeply.');
      const resources = form.dict.lookup(n('Resources')) || inherited;
      if (checkedForms.get(form)?.has(resources)) return;
      ancestors.add(form);
      for (const { op, args } of formOps(form)) if (op === 'Do') {
        if (args.length !== 1 || !(args[0] instanceof Name)) fail('Invalid XObject instruction.');
        const child = resources.lookup(n('XObject'))?.lookup(args[0]);
        if (!child) fail('Missing PDF drawing resource.');
        if (child instanceof Stream && child.dict.get(n('Subtype'))?.toString() === '/Form') validateFormGraph(child, resources, ancestors);
      }
      ancestors.delete(form);
      if (!checkedForms.has(form)) checkedForms.set(form, new WeakSet());
      checkedForms.get(form).add(resources);
    }

    function colorSpace(value, resources, depth = 0) {
      if (depth > 16) fail('Recursive color space.');
      value = lookup(value);
      if (value instanceof Name) {
        const name = value.toString();
        if (name === '/DeviceRGB' || name === '/DeviceGray') {
          const key = name === '/DeviceRGB' ? 'DefaultRGB' : 'DefaultGray';
          const override = resources?.lookup(n('ColorSpace'))?.lookup(n(key));
          return override ? colorSpace(override, resources, depth + 1) : name === '/DeviceRGB' ? defaultRGB : gray;
        }
        if (name === '/Pattern') return { kind: 'pattern' };
        const entry = resources?.lookup(n('ColorSpace'))?.lookup(value);
        if (!entry) fail(`Unsupported color space ${name}.`);
        return colorSpace(entry, resources, depth + 1);
      }
      if (value instanceof Arr && value.get(0).toString() === '/ICCBased') {
        const stream = lookup(value.get(1));
        if (!(stream instanceof Stream) || count(stream.dict, 'N') !== 3) fail('Only RGB source ICC profiles are supported.');
        if (!profileCache.has(stream)) {
          const profile = boundedDecode(stream, 1024 * 1024);
          if (profile.length < 132 || String.fromCharCode(...profile.subarray(16, 20)) !== 'RGB ') fail('Invalid RGB source ICC profile.');
          const range = stream.dict.lookup(n('Range'));
          if (range && array(range).some((v, i) => v !== i % 2)) fail('Nonstandard source ICC ranges are not supported.');
          profileCache.set(stream, { kind: 'rgb', components: 3, profile });
        }
        return profileCache.get(stream);
      }
      fail('This PDF uses an unsupported color space (such as spot, CMYK, Lab or indexed color).');
    }

    function rgbValues(values, space) {
      if (!space || !['rgb', 'gray'].includes(space.kind) || values.length !== space.components) fail('Unsupported or inherited color operands.');
      if (values.some(v => !Number.isFinite(v))) fail('Invalid source color.');
      values = values.map(v => Math.max(0, Math.min(1, v)));
      return space.kind === 'gray' ? [values[0], values[0], values[0]] : values;
    }

    async function converted(values, space) {
      active();
      const rgb = rgbValues(values, space);
      let profiles = colorCache.get(space.profile);
      if (!profiles) { profiles = new Map(); colorCache.set(space.profile, profiles); }
      const key = rgb.join(',');
      if (!profiles.has(key)) {
        if (profiles.size >= 65536) fail('This page has too many distinct vector colors.');
        profiles.set(key, Array.from(await session.convertColors(rgb, space.profile, { stillActive })));
      }
      stats.colors++;
      return profiles.get(key);
    }

    function rejectGroup(d) {
      if (d.has(n('Group'))) fail('Transparency groups are not supported yet.');
    }
    function validateState(d) {
      const blend = d.lookup(n('BM'));
      if (blend && blend.toString() !== '/Normal' && blend.toString() !== '/Compatible') fail('Blend modes are not supported yet.');
      const mask = d.lookup(n('SMask'));
      if (mask && mask.toString() !== '/None') fail('Transparency-group soft masks are not supported yet.');
      for (const key of ['TR', 'TR2', 'BG', 'BG2', 'UCR', 'UCR2', 'HT', 'OP', 'op', 'OPM', 'Font']) if (d.has(n(key))) fail(`Graphics-state ${key} is not supported yet.`);
      for (const key of ['CA', 'ca']) if (d.has(n(key))) { const v = count(d, key); if (v < 0 || v > 1) fail('Invalid opacity.'); if (v < 1) hasTransparency = true; }
    }

    async function shading(value, resources) {
      const original = dict(value);
      if (cachedObject(original, resources)) return cachedObject(original, resources);
      if (stats.gradients >= 128) fail('This page has too many vector gradients.');
      const type = count(original, 'ShadingType');
      if (![2, 3].includes(type)) fail('Only linear and radial vector gradients are supported.');
      const space = colorSpace(original.get(n('ColorSpace')), resources);
      if (!['rgb', 'gray'].includes(space.kind)) fail('Unsupported gradient color space.');
      const fn = evaluator.compile(doc, original.get(n('Function')));
      if (fn.inputs !== 1 || fn.outputs !== space.components) fail('Invalid gradient color function.');
      const domain = original.has(n('Domain')) ? array(original.get(n('Domain'))) : [0, 1];
      if (domain.length !== 2 || domain[0] >= domain[1]) fail('Invalid gradient domain.');
      // Preserve known hard stops with separate vector function intervals.
      // Uniform sampling alone could completely miss a narrow color band.
      const interior = [...new Set([...(fn.breakpoints || []), ...fn.domain].filter(v => v > domain[0] && v < domain[1]))].sort((a, b) => a - b);
      if (interior.length > 254) fail('This gradient has too many color stops.');
      const boundaries = [domain[0], ...interior, domain[1]], range = [0, 1, 0, 1, 0, 1, 0, 1];
      const functions = [];
      approximateGradient ||= fn.approximate;
      for (let interval = 0; interval < boundaries.length - 1; interval++) {
        active();
        const from = boundaries[interval], to = boundaries[interval + 1];
        const size = Math.max(2, Math.ceil((to - from) / (domain[1] - domain[0]) * 4096) + 1);
        const samples = new Float64Array(size * 3);
        for (let i = 0; i < size; i++) {
          let t = from + (to - from) * i / (size - 1);
          // Endpoints on opposite sides of a hard stop must not bleed into
          // one another. A one-ULP inset has no meaningful geometric width.
          if (i === 0 && interval > 0) t = adjacent(from, true);
          if (i === size - 1 && interval < boundaries.length - 2) t = adjacent(to, false);
          if (t < from || t > to) fail('Gradient stops are too close together.');
          samples.set(rgbValues(fn([t]), space), i * 3);
        }
        const colors = await session.convertColors(samples, space.profile, { stillActive });
        const packed = new Uint8Array(size * 8), dv = new DataView(packed.buffer);
        for (let i = 0; i < colors.length; i++) dv.setUint16(i * 2, Math.round(colors[i] * 65535));
        functions.push(ctx.register(ctx.flateStream(packed, { FunctionType: 0, Domain: [from, to], Range: range, Size: [size], BitsPerSample: 16, Order: 1, Encode: [0, size - 1], Decode: range })));
      }
      const gradient = functions.length === 1 ? functions[0] : ctx.register(ctx.obj({
        FunctionType: 3, Domain: domain, Bounds: interior, Functions: functions,
        Encode: boundaries.slice(0, -1).flatMap((from, i) => [from, boundaries[i + 1]]), Range: range
      }));
      const result = original.clone(ctx);
      result.set(n('ColorSpace'), target); result.set(n('Function'), gradient);
      if (original.has(n('Background'))) result.set(n('Background'), ctx.obj(await converted(array(original.get(n('Background'))), space)));
      cacheObject(original, resources, result); stats.gradients++; return result;
    }

    function validateMask(mask, width, height) {
      mask = lookup(mask);
      if (!(mask instanceof Stream) || mask.dict.get(n('Subtype'))?.toString() !== '/Image') fail('Unsupported image soft mask.');
      const d = mask.dict;
      if (count(d, 'Width') !== width || count(d, 'Height') !== height || count(d, 'BitsPerComponent') !== 8 || d.get(n('ColorSpace'))?.toString() !== '/DeviceGray') fail('Unsupported image soft-mask dimensions or format.');
      for (const key of ['Matte', 'SMask', 'Mask', 'Decode']) if (d.has(n(key))) fail(`Image soft-mask ${key} is not supported yet.`);
      const alpha = boundedDecode(mask, width * height);
      if (alpha.length !== width * height) fail('Incomplete image soft mask.');
      if (alpha.some(value => value !== 255)) hasTransparency = true;
    }

    async function image(original, resources) {
      const d = original.dict, width = count(d, 'Width'), height = count(d, 'Height');
      if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 16384) || width * height > MAX_IMAGE_PIXELS) fail('Embedded images are limited to 16 million pixels each.');
      stats.imagePixels += width * height;
      if (stats.imagePixels > MAX_PAGE_PIXELS) fail('Embedded images on one page exceed 32 million pixels.');
      if (d.get(n('ImageMask'))?.toString() === 'true' || count(d, 'BitsPerComponent') !== 8) fail('Only 8-bit color images are supported.');
      for (const key of ['Mask', 'Matte', 'Alternates', 'SMaskInData']) if (d.has(n(key))) fail(`Image ${key} is not supported yet.`);
      const space = colorSpace(d.get(n('ColorSpace')), resources);
      if (!['rgb', 'gray'].includes(space.kind)) fail('Unsupported image color space.');
      const decode = d.lookup(n('Decode'));
      if (decode && (array(decode).length !== space.components * 2 || array(decode).some((v, i) => v !== i % 2))) fail('Custom image decode ranges are not supported yet.');
      if (d.has(n('SMask'))) validateMask(d.get(n('SMask')), width, height);
      const f = d.lookup(n('Filter'));
      const filters = f instanceof Arr ? f.asArray().map(String) : f ? [String(f)] : [];
      let rgb;
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        if (space.kind !== 'rgb' || !decodeJpeg) fail('Unsupported JPEG color space.');
        const params = d.lookup(n('DecodeParms'));
        if (params && params.toString() !== 'null') fail('Custom JPEG decoding parameters are not supported yet.');
        const decoded = decodeJpeg(original.contents, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 16, maxMemoryUsageInMB: 256 });
        if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 3) fail('JPEG dimensions differ from the PDF.');
        rgb = decoded.data;
      } else {
        const bytes = boundedDecode(original, width * height * space.components);
        if (bytes.length !== width * height * space.components) fail('Incomplete image data.');
        if (space.kind === 'rgb') rgb = bytes;
        else { rgb = new Uint8Array(width * height * 3); for (let i = 0; i < bytes.length; i++) rgb.fill(bytes[i], i * 3, i * 3 + 3); }
      }
      active();
      const cmyk = await session.convertRgb8(rgb, space.profile, { stillActive });
      rgb = null;
      const result = ctx.flateStream(cmyk);
      for (const [key, value] of d.entries()) if (!['Length', 'Filter', 'DecodeParms', 'ColorSpace', 'Decode'].includes(key.decodeText())) result.dict.set(key, value);
      result.dict.set(n('ColorSpace'), target);
      stats.images++; return ctx.register(result);
    }

    async function resourcesFor(original, depth) {
      active();
      if (depth > 32) fail('PDF resources are nested too deeply.');
      original = dict(original);
      if (resourceCache.has(original)) return resourceCache.get(original);
      if (inProgress.has(original)) fail('Recursive PDF resources are not supported.');
      inProgress.add(original);
      resourceCount += original.keys().length;
      for (const key of ['ColorSpace', 'ExtGState', 'XObject', 'Shading', 'Pattern', 'Font']) {
        const child = original.lookup(n(key));
        if (child instanceof Dict) resourceCount += child.keys().length;
      }
      if (resourceCount > 100000) fail('This page has too many PDF resources.');
      const result = original.clone(ctx), spaces = ctx.obj({});
      let colorName = '__ExportCMYK';
      const existingSpaces = original.lookup(n('ColorSpace'));
      while (existingSpaces instanceof Dict && existingSpaces.has(n(colorName))) colorName += '_';
      spaces.set(n(colorName), target); result.set(n('ColorSpace'), spaces);
      const bundle = { original, result, colorName };
      // Source color resources are resolved from original, never from result.
      const gs = original.lookup(n('ExtGState'));
      if (gs) for (const value of dict(gs).values()) validateState(dict(value));
      const xobjects = original.lookup(n('XObject'));
      if (xobjects) {
        const out = ctx.obj({});
        for (const [key, ref] of dict(xobjects).entries()) {
          const object = lookup(ref);
          if (!(object instanceof Stream)) fail('Unsupported XObject.');
          if (!cachedObject(object, original)) {
            if (inProgress.has(object)) fail('Recursive Form XObject.');
            inProgress.add(object);
            const type = object.dict.get(n('Subtype'))?.toString();
            if (type === '/Image') cacheObject(object, original, await image(object, original));
            else if (type === '/Form') {
              if (stats.forms >= 2048) fail('This page has too many Form XObjects.');
              validateFormGraph(object, original);
              rejectGroup(object.dict);
              if (object.dict.has(n('Ref')) || object.dict.has(n('OPI'))) fail('External Form XObjects are not supported.');
              const ownResources = object.dict.lookup(n('Resources'));
              // A form without resources inherits this resource dictionary.
              const convertedResources = ownResources ? await resourcesFor(ownResources, depth + 1) : bundle;
              const bytes = await content(null, convertedResources, false, formOps(object));
              const stream = ctx.flateStream(bytes);
              for (const [k, v] of object.dict.entries()) if (!['Length', 'Filter', 'DecodeParms', 'Resources'].includes(k.decodeText())) stream.dict.set(k, v);
              stream.dict.set(n('Resources'), convertedResources.result);
              cacheObject(object, original, ctx.register(stream)); stats.forms++;
            } else fail(`Unsupported XObject ${type}.`);
            inProgress.delete(object);
          }
          out.set(key, cachedObject(object, original));
        }
        result.set(n('XObject'), out);
      }
      const shadings = original.lookup(n('Shading'));
      if (shadings) {
        const out = ctx.obj({});
        for (const [key, value] of dict(shadings).entries()) out.set(key, await shading(value, original));
        result.set(n('Shading'), out);
      }
      const patterns = original.lookup(n('Pattern'));
      if (patterns) {
        const out = ctx.obj({});
        for (const [key, value] of dict(patterns).entries()) {
          const pattern = dict(value);
          if (count(pattern, 'PatternType') !== 2) fail('Tiling patterns are not supported yet.');
          if (pattern.has(n('ExtGState'))) validateState(dict(pattern.get(n('ExtGState'))));
          const clone = pattern.clone(ctx); clone.set(n('Shading'), await shading(pattern.get(n('Shading')), original)); out.set(key, clone);
        }
        result.set(n('Pattern'), out);
      }
      const fonts = original.lookup(n('Font'));
      if (fonts) for (const value of dict(fonts).values()) {
        const font = dict(value);
        if (font.get(n('Subtype'))?.toString() === '/Type3') {
          // Figma emits empty Type3 glyphs for its invisible text layer, while
          // visible text is outlined in page content. Colored Type3 fonts need
          // a separate inherited-color interpreter, so reject them explicitly.
          for (const value of dict(font.get(n('CharProcs'))).values()) {
            const glyphOps = parseOperations(readContent(lookup(value)));
            if (glyphOps.length !== 1 || glyphOps[0].op !== 'd1') fail('Painted Type3 fonts are not supported yet.');
          }
        }
      }
      resourceCache.set(original, bundle); inProgress.delete(original);
      return bundle;
    }

    async function content(bytes, bundle, root, parsed) {
      const ops = parsed || parseOperations(bytes), output = [], stack = [];
      let state = { fill: root ? gray : null, stroke: root ? gray : null };
      const emitColor = async (args, space, stroke) => {
        const color = await converted(args, space);
        output.push(`/${bundle.colorName} ${stroke ? 'CS' : 'cs'}\n${color.map(format).join(' ')} ${stroke ? 'SCN' : 'scn'}`);
      };
      if (root) { await emitColor([0], gray, false); await emitColor([0], gray, true); }
      for (let index = 0; index < ops.length; index++) {
        active();
        const { op, args } = ops[index];
        const stroke = ['CS', 'SC', 'SCN', 'G', 'RG', 'K'].includes(op), channel = stroke ? 'stroke' : 'fill';
        if (op === 'q') { if (stack.length >= 128) fail('Graphics state nesting is too deep.'); stack.push({ ...state }); }
        else if (op === 'Q') { if (!stack.length) fail('Unbalanced PDF graphics state.'); state = stack.pop(); }
        else if (op === 'CS' || op === 'cs') {
          if (args.length !== 1) fail('Invalid color-space instruction.');
          state[channel] = colorSpace(args[0], bundle.original);
          if (state[channel].kind === 'pattern') output.push(`/Pattern ${op}`);
          else {
            // cs/CS reset the corresponding color, even without a following sc.
            await emitColor(Array(state[channel].components).fill(0), state[channel], stroke);
          }
          continue;
        } else if (['RG', 'rg', 'G', 'g', 'K', 'k'].includes(op)) {
          if (op.toLowerCase() === 'k') fail('Already-CMYK device colors are not supported as source colors.');
          state[channel] = colorSpace(n(op.toLowerCase() === 'rg' ? 'DeviceRGB' : 'DeviceGray'), bundle.original);
          await emitColor(args.map(number), state[channel], stroke); continue;
        } else if (['SC', 'SCN', 'sc', 'scn'].includes(op)) {
          if (state[channel]?.kind === 'pattern') {
            if (!['SCN', 'scn'].includes(op) || args.length !== 1 || !(args[0] instanceof Name) || !bundle.result.lookup(n('Pattern'))?.has(args[0])) fail('Unsupported pattern color instruction.');
          } else { await emitColor(args.map(number), state[channel], stroke); continue; }
        } else if (op === 'gs') {
          if (args.length !== 1 || !(args[0] instanceof Name)) fail('Invalid graphics-state instruction.');
          const entry = bundle.original.lookup(n('ExtGState'))?.lookup(args[0]);
          if (!entry) fail('Missing graphics state.'); validateState(dict(entry));
        } else if (op === 'Do' || op === 'sh') {
          if (args.length !== 1 || !(args[0] instanceof Name) || !bundle.result.lookup(n(op === 'Do' ? 'XObject' : 'Shading'))?.has(args[0])) fail('Missing PDF drawing resource.');
        }
        output.push(`${args.map(String).join(' ')}${args.length ? ' ' : ''}${op}`);
        if (index % 4096 === 4095) { await new Promise(resolve => setTimeout(resolve, 0)); active(); }
      }
      if (stack.length) fail('Unbalanced PDF graphics state.');
      return new TextEncoder().encode(output.join('\n') + '\n');
    }

    rejectGroup(page.node);
    // Appearance streams would need their own conversion; link annotations
    // created by Figma have no appearance stream and remain untouched.
    const annotations = page.node.lookup(n('Annots'));
    if (annotations instanceof Arr) for (const ref of annotations.asArray()) {
      const a = dict(ref);
      if (a.has(n('AP')) || a.get(n('Subtype'))?.toString() !== '/Link') fail('Non-link PDF annotations are not supported.');
    }
    const resources = page.node.Resources() || ctx.obj({});
    const bundle = await resourcesFor(resources, 0);
    const value = page.node.Contents();
    const streams = value instanceof Arr ? value.asArray().map(lookup) : value ? [lookup(value)] : [];
    const chunks = [];
    for (const stream of streams) chunks.push(readContent(stream));
    const length = chunks.reduce((sum, b) => sum + b.length + 1, 0);
    if (length > MAX_CONTENT) fail('The page drawing instructions exceed 16 MiB.');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; bytes[offset++] = 10; }
    const convertedContent = await content(bytes, bundle, true);
    active();
    page.node.set(n('Contents'), ctx.register(ctx.flateStream(convertedContent)));
    page.node.set(n('Resources'), bundle.result);
    const warnings = [];
    if (hasTransparency) warnings.push('Vector CMYK preserves transparency. Overlapping colors can look different from RGB or Rasterized CMYK; check the PDF before printing.');
    if (approximateGradient) warnings.push('Some vector gradient colors are approximated. Check very narrow color stops before printing.');
    return { warnings, stats };
  }
  return { convertPage };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createVectorCmykConverter };
