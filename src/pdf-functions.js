// PDF function subset for gradient conversion. No JavaScript evaluation of PDF data.
// Type 4 semantics follow PDF 32000-1 §7.10.5 / PostScript arithmetic conventions.
// Limits are deliberate: unsupported functions fail instead of producing guessed colors.
function createPdfFunctionEvaluator(PDFLib) {
  const { PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFRef, PDFNull, decodePDFRawStream } = PDFLib;
  const MAX_INPUTS = 4, MAX_OUTPUTS = 16, MAX_DEPTH = 32, MAX_FUNCTIONS = 256;
  const MAX_STREAM = 2 * 1024 * 1024, MAX_PROGRAM = 65536;
  const MAX_TOKENS = 10000, MAX_STEPS = 20000, MAX_STACK = 256, MAX_BREAKPOINTS = 16384;
  const INTEGER_MIN = -2147483648, INTEGER_MAX = 2147483647;
  const fail = message => { throw new Error(`PDF function: ${message}`); };
  const finite = value => { if (!Number.isFinite(value)) fail('non-finite numeric result.'); return value; };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const integerFits = value => Number.isInteger(value) && value >= INTEGER_MIN && value <= INTEGER_MAX;
  const numeric = (n, integer = false) => ({ n: finite(n), integer: integer && integerFits(n) });
  const operators = new Set(('abs add atan ceiling cos cvi cvr div exp floor idiv ln log mod mul neg round sin sqrt sub truncate ' +
    'and bitshift eq false ge gt le lt ne not or true xor copy dup exch index pop roll').split(' '));

  function readStream(stream, limit, resolve) {
    if (!(stream instanceof PDFRawStream)) fail('function type requires a stream.');
    const bytes = stream.contents;
    if (bytes.length > MAX_STREAM) fail('encoded function stream exceeds 2 MiB.');
    let filter = resolve(stream.dict.get(PDFName.of('Filter')));
    if (filter instanceof PDFArray && filter.size() === 1) filter = resolve(filter.get(0));
    if (!filter || filter === PDFNull) {
      if (bytes.length > limit) fail('decoded function stream exceeds its limit.');
      return bytes.slice();
    }
    if (!(filter instanceof PDFName) || filter.asString() !== '/FlateDecode') fail('unsupported function stream filter; only FlateDecode is supported.');
    let parms = resolve(stream.dict.get(PDFName.of('DecodeParms')));
    if (parms instanceof PDFArray && parms.size() === 1) parms = resolve(parms.get(0));
    if (parms && parms !== PDFNull) {
      if (!(parms instanceof PDFDict)) fail('invalid function DecodeParms.');
      const predictor = resolve(parms.get(PDFName.of('Predictor')));
      if (predictor && (!(predictor instanceof PDFNumber) || predictor.asNumber() !== 1)) fail('function stream predictors are unsupported.');
    }
    if (bytes.length < 6 || (bytes[0] & 15) !== 8 || (bytes[0] >> 4) > 7 || ((bytes[0] << 8) + bytes[1]) % 31 || (bytes[1] & 32)) fail('invalid Flate function header.');
    // Decode only one filter: otherwise an inner decoder could expand before its
    // outer decoder's allocation guard runs. pdf-lib 1.17.1 exposes ensureBuffer.
    const dict = stream.dict.clone(); dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode')); dict.delete(PDFName.of('DecodeParms'));
    const decoder = decodePDFRawStream(PDFRawStream.of(dict, bytes));
    const original = decoder.ensureBuffer;
    if (typeof original !== 'function') fail('bounded Flate decoder is unavailable.');
    decoder.ensureBuffer = function (requested) {
      if (requested > limit) fail('decoded function stream exceeds its limit.');
      return original.call(this, requested);
    };
    const decoded = decoder.decode();
    if (decoded.length > limit) fail('decoded function stream exceeds its limit.');
    let a = 1, b = 0;
    for (const byte of decoded) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    const checksum = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
    if ((((b << 16) | a) >>> 0) !== checksum) fail('invalid Flate function checksum.');
    return decoded.slice();
  }

  function parseCalculator(bytes) {
    let source = '';
    for (const byte of bytes) { if (byte > 127) fail('non-ASCII calculator program.'); source += String.fromCharCode(byte); }
    const tokens = []; let offset = 0;
    while (offset < source.length) {
      const char = source[offset];
      if (/[\x00\x09\x0a\x0c\x0d\x20]/.test(char)) { offset++; continue; }
      if (char === '%') { while (offset < source.length && !/[\r\n]/.test(source[offset])) offset++; continue; }
      if (char === '{' || char === '}') { tokens.push(char); offset++; }
      else {
        const start = offset;
        while (offset < source.length && !/[\x00\x09\x0a\x0c\x0d\x20{}%]/.test(source[offset])) offset++;
        const token = source.slice(start, offset);
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) tokens.push(numeric(Number(token), !token.includes('.')));
        else if (operators.has(token) || token === 'if' || token === 'ifelse') tokens.push(token);
        else fail(`unsupported calculator token ${token.slice(0, 32)}.`);
      }
      if (tokens.length > MAX_TOKENS) fail('calculator token limit exceeded.');
    }
    let cursor = 0;
    function block(depth) {
      if (depth > MAX_DEPTH) fail('calculator nesting limit exceeded.');
      if (tokens[cursor++] !== '{') fail('calculator program must be enclosed in braces.');
      const instructions = [];
      while (cursor < tokens.length && tokens[cursor] !== '}') {
        if (tokens[cursor] === '{') {
          const yes = block(depth + 1);
          if (tokens[cursor] === '{') {
            const no = block(depth + 1);
            if (tokens[cursor++] !== 'ifelse') fail('calculator branches require ifelse.');
            instructions.push({ yes, no });
          } else {
            if (tokens[cursor++] !== 'if') fail('calculator block requires if.');
            instructions.push({ yes, no: [] });
          }
        } else {
          const token = tokens[cursor++];
          if (token === 'if' || token === 'ifelse') fail('calculator conditional is missing its braces.');
          instructions.push(token);
        }
      }
      if (tokens[cursor++] !== '}') fail('unterminated calculator block.');
      return instructions;
    }
    const program = block(0);
    if (cursor !== tokens.length) fail('trailing calculator tokens.');
    return program;
  }

  function runCalculator(program, inputs, outputs, budget) {
    const stack = inputs.map(value => numeric(value));
    const push = value => { if (stack.length >= MAX_STACK) fail('calculator stack limit exceeded.'); stack.push(value); };
    const pop = () => { if (!stack.length) fail('calculator stack underflow.'); return stack.pop(); };
    const number = () => { const value = pop(); if (!value || typeof value !== 'object' || !('n' in value)) fail('calculator expected a number.'); return value; };
    const integer = () => { const value = number(); if (!value.integer) fail('calculator expected a 32-bit integer.'); return value.n; };
    const boolean = () => { const value = pop(); if (typeof value !== 'boolean') fail('calculator expected a boolean.'); return value; };
    function run(instructions) {
      for (const instruction of instructions) {
        if (--budget.steps < 0) fail('function instruction limit exceeded.');
        if (typeof instruction === 'object') {
          if ('n' in instruction) push(instruction);
          else run(boolean() ? instruction.yes : instruction.no);
          continue;
        }
        const op = instruction;
        if (op === 'true' || op === 'false') { push(op === 'true'); continue; }
        if (op === 'pop') { pop(); continue; }
        if (op === 'dup') { const v = pop(); push(v); push(v); continue; }
        if (op === 'exch') { const b = pop(), a = pop(); push(b); push(a); continue; }
        if (op === 'copy' || op === 'index' || op === 'roll') {
          const shift = op === 'roll' ? integer() : 0, n = integer();
          if (n < 0 || n > stack.length || (op === 'index' && n === stack.length)) fail(`calculator ${op} index is out of range.`);
          if (op === 'index') push(stack[stack.length - n - 1]);
          else if (op === 'copy') { const copy = n ? stack.slice(-n) : []; for (const value of copy) push(value); }
          else if (n) { const r = ((shift % n) + n) % n; if (r) stack.splice(stack.length - n, 0, ...stack.splice(stack.length - r, r)); }
          continue;
        }
        if (op === 'eq' || op === 'ne') {
          const b = pop(), a = pop();
          const equal = typeof a === typeof b && (typeof a === 'boolean' ? a === b : a.n === b.n);
          push(op === 'eq' ? equal : !equal); continue;
        }
        if (['and', 'or', 'xor', 'not'].includes(op)) {
          const b = pop(), a = op === 'not' ? b : pop();
          if (typeof a === 'boolean' && typeof b === 'boolean') push(op === 'and' ? a && b : op === 'or' ? a || b : op === 'xor' ? a !== b : !b);
          else {
            if (!a?.integer || !b?.integer) fail('calculator bitwise operands must both be integers or booleans.');
            push(numeric(op === 'and' ? a.n & b.n : op === 'or' ? a.n | b.n : op === 'xor' ? a.n ^ b.n : ~b.n, true));
          }
          continue;
        }
        if (op === 'bitshift') {
          const shift = integer(), value = integer();
          push(numeric(Math.abs(shift) >= 32 ? 0 : shift >= 0 ? value << shift : (value >>> -shift) | 0, true)); continue;
        }
        if (['add', 'sub', 'mul', 'div', 'idiv', 'mod', 'exp', 'atan', 'gt', 'ge', 'lt', 'le'].includes(op)) {
          const b = number(), a = number();
          if (['gt', 'ge', 'lt', 'le'].includes(op)) { push(op === 'gt' ? a.n > b.n : op === 'ge' ? a.n >= b.n : op === 'lt' ? a.n < b.n : a.n <= b.n); continue; }
          if (['div', 'idiv', 'mod'].includes(op) && b.n === 0) fail('calculator division by zero.');
          if (['idiv', 'mod'].includes(op) && (!a.integer || !b.integer)) fail('calculator integer division requires integers.');
          if (op === 'atan' && a.n === 0 && b.n === 0) fail('calculator atan is undefined at zero.');
          const value = op === 'add' ? a.n + b.n : op === 'sub' ? a.n - b.n : op === 'mul' ? a.n * b.n : op === 'div' ? a.n / b.n :
            op === 'idiv' ? Math.trunc(a.n / b.n) : op === 'mod' ? a.n % b.n : op === 'exp' ? a.n ** b.n : (Math.atan2(a.n, b.n) * 180 / Math.PI + 360) % 360;
          if (op === 'idiv' && !integerFits(value)) fail('calculator integer division overflow.');
          push(numeric(value, !['div', 'exp', 'atan'].includes(op) && a.integer && b.integer)); continue;
        }
        const a = number();
        if (op === 'cvi') { const n = Math.trunc(a.n); if (!integerFits(n)) fail('calculator integer conversion overflow.'); push(numeric(n, true)); continue; }
        const value = op === 'abs' ? Math.abs(a.n) : op === 'neg' ? -a.n : op === 'ceiling' ? Math.ceil(a.n) : op === 'floor' ? Math.floor(a.n) :
          op === 'round' ? Math.round(a.n) : op === 'truncate' ? Math.trunc(a.n) : op === 'sqrt' ? Math.sqrt(a.n) : op === 'ln' ? Math.log(a.n) :
            op === 'log' ? Math.log10(a.n) : op === 'sin' ? Math.sin(a.n * Math.PI / 180) : op === 'cos' ? Math.cos(a.n * Math.PI / 180) : a.n;
        push(numeric(value, !['cvr', 'sqrt', 'ln', 'log', 'sin', 'cos'].includes(op) && a.integer));
      }
    }
    run(program);
    if (stack.length !== outputs) fail(`calculator returned ${stack.length} operands; expected ${outputs}.`);
    return stack.map(value => { if (!value || typeof value !== 'object' || !('n' in value)) fail('calculator output is not numeric.'); return finite(value.n); });
  }

  function compile(pdfDoc, functionObj) {
    if (!pdfDoc?.context) fail('a PDFDocument context is required.');
    const context = pdfDoc.context, active = new Set(), cache = new Map(); let compiledCount = 0;
    const resolve = object => {
      const seen = new Set();
      while (object instanceof PDFRef) {
        const key = object.toString(); if (seen.has(key) || seen.size >= MAX_DEPTH) fail('cyclic or excessively deep function reference.');
        seen.add(key); object = context.lookup(object); if (!object) fail('missing indirect function object.');
      }
      return object;
    };
    const array = (object, name, optional = false) => {
      object = resolve(object); if (!object && optional) return null;
      if (!(object instanceof PDFArray) || object.size() > 2 * MAX_FUNCTIONS) fail(`invalid ${name} array.`);
      return object.asArray().map(item => { item = resolve(item); if (!(item instanceof PDFNumber)) fail(`${name} must contain numbers.`); return finite(item.asNumber()); });
    };
    const pairs = (object, name, maximum, required, strict) => {
      const result = array(object, name, !required); if (!result) return null;
      if (!result.length || result.length % 2 || result.length > maximum * 2) fail(`invalid ${name} dimensions.`);
      for (let i = 0; i < result.length; i += 2) if (strict ? result[i] >= result[i + 1] : result[i] > result[i + 1]) fail(`invalid ${name} interval.`);
      return result;
    };
    const scalar = (dict, key, fallback) => {
      const value = resolve(dict.get(PDFName.of(key)));
      if (value === undefined && fallback !== undefined) return fallback;
      if (!(value instanceof PDFNumber)) fail(`invalid ${key}.`);
      return finite(value.asNumber());
    };
    function build(object, depth) {
      object = resolve(object);
      if (depth > MAX_DEPTH) fail('function nesting limit exceeded.');
      if (active.has(object)) fail('cyclic function graph.');
      if (cache.has(object)) return cache.get(object);
      if (++compiledCount > MAX_FUNCTIONS) fail('function graph limit exceeded.');
      active.add(object);
      let domain, range, outputs, evaluate, approximate = false;
      const breakpointSet = new Set();
      // Scalar input coordinates where a sampled converter should split. Domain
      // endpoints belong to the caller; multidimensional functions have no such
      // scalar list. Calculator literals are candidates, not a completeness claim.
      const addBreakpoint = value => {
        finite(value);
        if (domain.length !== 2 || value <= domain[0] || value >= domain[1]) return;
        breakpointSet.add(value);
        if (breakpointSet.size > MAX_BREAKPOINTS) fail('function breakpoint limit exceeded.');
      };
      if (object instanceof PDFArray) {
        if (!object.size() || object.size() > MAX_OUTPUTS) fail('invalid function array size.');
        const members = object.asArray().map(item => build(item, depth + 1));
        domain = members[0].domain.slice(); outputs = members.length;
        if (members.some(member => member.outputs !== 1 || JSON.stringify(member.domain) !== JSON.stringify(domain))) fail('function arrays require one-output members with identical domains.');
        range = members.every(member => member.range) ? members.flatMap(member => member.range) : null;
        approximate = members.some(member => member.approximate);
        for (const member of members) for (const value of member.breakpoints) addBreakpoint(value);
        evaluate = (input, budget) => members.map(member => member.run(input, budget)[0]);
      } else {
        const dict = object instanceof PDFRawStream ? object.dict : object;
        if (!(dict instanceof PDFDict)) fail('function must be a dictionary, stream, or array.');
        const type = scalar(dict, 'FunctionType');
        domain = pairs(dict.get(PDFName.of('Domain')), 'Domain', MAX_INPUTS, true, true);
        range = pairs(dict.get(PDFName.of('Range')), 'Range', MAX_OUTPUTS, type === 0 || type === 4, false);
        const inputs = domain.length / 2;
        if (type === 0) {
          outputs = range.length / 2;
          const size = array(dict.get(PDFName.of('Size')), 'Size');
          if (size.length !== inputs || size.some(n => !Number.isInteger(n) || n < 1 || n > 4096)) fail('invalid sampled function grid.');
          const points = size.reduce((a, b) => a * b, 1), values = points * outputs;
          if (points > 262144 || values > 1048576) fail('sampled function grid limit exceeded.');
          const bits = scalar(dict, 'BitsPerSample');
          if (![8, 16].includes(bits)) fail('only 8-bit and 16-bit sampled functions are supported.');
          if (scalar(dict, 'Order', 1) !== 1) fail('only linear sampled interpolation is supported.');
          const encode = array(dict.get(PDFName.of('Encode')), 'Encode', true) || size.flatMap(n => [0, n - 1]);
          const decode = array(dict.get(PDFName.of('Decode')), 'Decode', true) || range.slice();
          if (encode.length !== inputs * 2 || decode.length !== outputs * 2) fail('invalid sampled Encode or Decode.');
          const samples = readStream(object, MAX_STREAM, resolve);
          if (samples.length !== values * bits / 8) fail('sampled function data length does not match its grid.');
          if (inputs === 1 && encode[0] !== encode[1]) {
            const span = finite(encode[1] - encode[0]), domainSpan = finite(domain[1] - domain[0]);
            for (let i = 0; i < size[0]; i++) {
              const t = (i - encode[0]) / span;
              if (t > 0 && t < 1) addBreakpoint(domain[0] + t * domainSpan);
            }
          }
          evaluate = input => {
            const low = [], high = [], weights = [], strides = []; let stride = outputs;
            for (let i = 0; i < inputs; i++) {
              const encoded = clamp(encode[i * 2] + (input[i] - domain[i * 2]) / (domain[i * 2 + 1] - domain[i * 2]) * (encode[i * 2 + 1] - encode[i * 2]), 0, size[i] - 1);
              low.push(Math.floor(encoded)); high.push(Math.min(size[i] - 1, Math.floor(encoded) + 1)); weights.push(encoded - Math.floor(encoded)); strides.push(stride); stride *= size[i];
            }
            const result = new Array(outputs).fill(0);
            for (let corner = 0; corner < 1 << inputs; corner++) {
              let weight = 1, offset = 0;
              for (let i = 0; i < inputs; i++) { const upper = corner & (1 << i); weight *= upper ? weights[i] : 1 - weights[i]; offset += (upper ? high[i] : low[i]) * strides[i]; }
              if (!weight) continue;
              for (let channel = 0; channel < outputs; channel++) {
                const sampleIndex = offset + channel;
                const sample = bits === 8 ? samples[sampleIndex] : samples[sampleIndex * 2] * 256 + samples[sampleIndex * 2 + 1];
                result[channel] += weight * sample / (bits === 8 ? 255 : 65535);
              }
            }
            return result.map((value, i) => decode[i * 2] + value * (decode[i * 2 + 1] - decode[i * 2]));
          };
        } else if (type === 2) {
          if (inputs !== 1 || object instanceof PDFRawStream) fail('exponential functions require a one-input dictionary.');
          const c0 = array(dict.get(PDFName.of('C0')), 'C0', true) || [0], c1 = array(dict.get(PDFName.of('C1')), 'C1', true) || [1];
          outputs = c0.length;
          if (!outputs || outputs > MAX_OUTPUTS || c1.length !== outputs) fail('invalid exponential function coefficients.');
          const exponent = scalar(dict, 'N');
          evaluate = input => { const factor = finite(input[0] ** exponent); return c0.map((value, i) => value + factor * (c1[i] - value)); };
        } else if (type === 3) {
          if (inputs !== 1 || object instanceof PDFRawStream) fail('stitching functions require a one-input dictionary.');
          const list = resolve(dict.get(PDFName.of('Functions')));
          if (!(list instanceof PDFArray) || !list.size() || list.size() > MAX_FUNCTIONS) fail('invalid stitching Functions.');
          const members = list.asArray().map(item => build(item, depth + 1)); outputs = members[0].outputs;
          if (members.some(member => member.inputs !== 1 || member.outputs !== outputs)) fail('incompatible stitched function dimensions.');
          const bounds = array(dict.get(PDFName.of('Bounds')), 'Bounds'), encode = array(dict.get(PDFName.of('Encode')), 'Encode');
          if (bounds.length !== members.length - 1 || encode.length !== members.length * 2) fail('invalid stitching Bounds or Encode.');
          const divisions = [domain[0], ...bounds, domain[1]];
          if (divisions.some((value, i) => i && value <= divisions[i - 1])) fail('stitching bounds must be strictly increasing inside Domain.');
          approximate = members.some(member => member.approximate);
          for (const value of bounds) addBreakpoint(value);
          members.forEach((member, i) => {
            const start = encode[i * 2], end = encode[i * 2 + 1];
            if (start === end) return;
            const span = finite(end - start), intervalSpan = finite(divisions[i + 1] - divisions[i]);
            // Child Domain endpoints are also slope boundaries when Encode
            // crosses them, because each child clips its own input first.
            for (const value of [...member.domain, ...member.breakpoints]) {
              const t = (value - start) / span;
              if (t > 0 && t < 1) addBreakpoint(divisions[i] + t * intervalSpan);
            }
          });
          evaluate = (input, budget) => {
            let i = 0; while (i < bounds.length && input[0] >= bounds[i]) i++;
            const x = encode[i * 2] + (input[0] - divisions[i]) / (divisions[i + 1] - divisions[i]) * (encode[i * 2 + 1] - encode[i * 2]);
            return members[i].run([finite(x)], budget);
          };
        } else if (type === 4) {
          outputs = range.length / 2;
          const program = parseCalculator(readStream(object, MAX_PROGRAM, resolve));
          approximate = true;
          const collectCandidates = instructions => {
            for (const instruction of instructions) if (typeof instruction === 'object') {
              if ('n' in instruction) addBreakpoint(instruction.n);
              else { collectCandidates(instruction.yes); collectCandidates(instruction.no); }
            }
          };
          collectCandidates(program);
          evaluate = (input, budget) => runCalculator(program, input, outputs, budget);
        } else fail(`unsupported FunctionType ${type}.`);
      }
      if (range && range.length !== outputs * 2) fail('Range does not match function output count.');
      const inputs = domain.length / 2;
      const run = (input, budget) => {
        if (--budget.steps < 0) fail('function instruction limit exceeded.');
        if (!Array.isArray(input) || input.length !== inputs || input.some(value => !Number.isFinite(value))) fail(`function requires ${inputs} finite numeric inputs.`);
        const result = evaluate(input.map((value, i) => clamp(value, domain[i * 2], domain[i * 2 + 1])), budget);
        if (result.length !== outputs) fail('incorrect function output count.');
        return result.map((value, i) => { finite(value); return range ? clamp(value, range[i * 2], range[i * 2 + 1]) : value; });
      };
      const result = { domain: Object.freeze(domain.slice()), range: range && Object.freeze(range.slice()), inputs, outputs, run,
        breakpoints: Object.freeze([...breakpointSet].sort((a, b) => a - b)), approximate };
      active.delete(object); cache.set(object, result); return result;
    }
    const built = build(functionObj, 0), callable = input => built.run(input, { steps: MAX_STEPS });
    Object.defineProperties(callable, Object.fromEntries(['domain', 'range', 'inputs', 'outputs', 'breakpoints', 'approximate'].map(key => [key, { value: built[key], enumerable: true }])));
    return callable;
  }
  return { compile };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createPdfFunctionEvaluator };
