const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PDFLib = require('pdf-lib');
const { createPdfFunctionEvaluator } = require('../src/pdf-functions.js');
const { PDFDocument, PDFName, PDFRawStream, PDFDict } = PDFLib;
const evaluator = createPdfFunctionEvaluator(PDFLib);
const close = (actual, expected, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => assert(Math.abs(n - expected[i]) <= tolerance, `${n} differs from ${expected[i]}`));
};
const exp = (doc, options = {}) => doc.context.obj({ FunctionType: 2, Domain: [0, 1], N: 1, ...options });
const sampled = (doc, data, options = {}) => doc.context.stream(Uint8Array.from(data), { FunctionType: 0, Domain: [0, 1], Range: [0, 1], Size: [2], BitsPerSample: 8, ...options });
const calculator = (doc, body, outputs = 1, options = {}) => doc.context.stream(`{ ${body} }`, { FunctionType: 4, Domain: [0, 1], Range: Array.from({ length: outputs }, () => [-1e12, 1e12]).flat(), ...options });
const compile = (doc, fn) => evaluator.compile(doc, fn);

test('exponential functions preserve input coordinates, defaults, metadata and domain/range clipping', async () => {
  const doc = await PDFDocument.create();
  const f = compile(doc, exp(doc, { C0: [1, 0, 0], C1: [0, 0, 1] }));
  close(f([0.25]), [0.75, 0, 0.25]); close(f([-1]), [1, 0, 0]); close(f([2]), [0, 0, 1]);
  assert.deepEqual(f.domain, [0, 1]); assert.equal(f.range, null); assert.equal(f.inputs, 1); assert.equal(f.outputs, 3);
  assert(Object.isFrozen(f.domain));
  close(compile(doc, exp(doc, { Domain: [1, 3], N: 2 }))([2]), [4]);
  close(compile(doc, exp(doc, { C0: [-2], C1: [2], Range: [0, 1] }))([0]), [0]);
  close(compile(doc, exp(doc, { C0: [-2], C1: [2], Range: [0, 1] }))([1]), [1]);
  for (const input of [[], [0, 1], [NaN], [Infinity], ['0.5'], null]) assert.throws(() => f(input), /finite numeric inputs/);
});

test('sampled8 functions interpolate channels and honor reversed Encode and single-sample axes', async () => {
  const doc = await PDFDocument.create(), samples = [255, 0, 0, 0, 0, 255];
  const options = { Range: [0, 1, 0, 1, 0, 1] };
  close(compile(doc, sampled(doc, samples, options))([0.25]), [0.75, 0, 0.25]);
  close(compile(doc, sampled(doc, samples, { ...options, Encode: [1, 0] }))([0.25]), [0.25, 0, 0.75]);
  close(compile(doc, sampled(doc, [128], { Size: [1] }))([0.9]), [128 / 255]);
  close(compile(doc, sampled(doc, [0, 255], { Encode: [-1, 2] }))([-5]), [0]);
  close(compile(doc, sampled(doc, [0, 255], { Encode: [-1, 2] }))([5]), [1]);
});

test('sampled16 reads big-endian samples and applies Decode before Range', async () => {
  const doc = await PDFDocument.create();
  const f = compile(doc, sampled(doc, [0, 0, 255, 255], { BitsPerSample: 16, Range: [-1, 1], Decode: [-2, 2] }));
  close(f([0]), [-1]); close(f([0.25]), [-1]); close(f([0.5]), [0]); close(f([0.75]), [1]);
  const exact = compile(doc, sampled(doc, [0x12, 0x34], { BitsPerSample: 16, Size: [1] }));
  close(exact([0]), [0x1234 / 65535]);
});

test('sampled multilinear indexing varies first input fastest, including 4D interpolation', async () => {
  const doc = await PDFDocument.create();
  const f = compile(doc, sampled(doc, [0, 64, 128, 255], { Domain: [0, 1, 0, 1], Size: [2, 2] }));
  close(f([1, 0]), [64 / 255]); close(f([0, 1]), [128 / 255]); close(f([0.5, 0.5]), [111.75 / 255]);
  const four = compile(doc, sampled(doc, Array.from({ length: 16 }, (_, i) => i * 17), { Domain: [0, 1, 0, 1, 0, 1, 0, 1], Size: [2, 2, 2, 2] }));
  close(four([0.5, 0.5, 0.5, 0.5]), [0.5]); close(four([1, 0, 0, 0]), [1 / 15]); close(four([0, 0, 0, 1]), [8 / 15]);
});

test('stitching picks the upper interval at a boundary and supports reverse mapping', async () => {
  const doc = await PDFDocument.create();
  const left = exp(doc, { C0: [0], C1: [1] }), right = exp(doc, { C0: [10], C1: [20] });
  const fn = doc.context.obj({ FunctionType: 3, Domain: [0, 1], Functions: [doc.context.register(left), right], Bounds: [0.5], Encode: [0, 1, 1, 0] });
  const f = compile(doc, fn);
  close(f([0.25]), [0.5]); close(f([0.5]), [20]); close(f([0.75]), [15]); close(f([1]), [10]);
  fn.set(PDFName.of('Range'), doc.context.obj([0, 12])); close(compile(doc, fn)([0.5]), [12]);
});

test('arrays resolve indirect one-channel functions and preserve channel ordering', async () => {
  const doc = await PDFDocument.create();
  const array = doc.context.obj([doc.context.register(exp(doc)), exp(doc, { C0: [1], C1: [0] }), exp(doc, { C0: [0.25], C1: [0.25] })]);
  const f = compile(doc, doc.context.register(array));
  close(f([0.4]), [0.4, 0.6, 0.25]); assert.equal(f.outputs, 3); assert.equal(f.range, null);
  assert.throws(() => compile(doc, doc.context.obj([exp(doc), exp(doc, { Domain: [0, 2] })])), /identical domains/);
  assert.throws(() => compile(doc, doc.context.obj([exp(doc, { C0: [0, 0], C1: [1, 1] })])), /one-output/);
});

test('scalar sampled breakpoints use input coordinates, including reversed and clipped Encode', async () => {
  const doc = await PDFDocument.create();
  const build = options => compile(doc, sampled(doc, [0, 64, 128, 192, 255], { Size: [5], Domain: [10, 20], ...options }));
  assert.deepEqual(build({}).breakpoints, [12.5, 15, 17.5]);
  assert.deepEqual(build({ Encode: [4, 0] }).breakpoints, [12.5, 15, 17.5]);
  close(build({ Encode: [-1, 5] }).breakpoints, [10 + 10 / 6, 10 + 20 / 6, 15, 10 + 40 / 6, 10 + 50 / 6]);
  assert.deepEqual(build({ Encode: [2, 2] }).breakpoints, []);
  assert.equal(build({}).approximate, false);
  assert(Object.isFrozen(build({}).breakpoints));
  assert.deepEqual(compile(doc, exp(doc)).breakpoints, []);
  assert.equal(compile(doc, exp(doc)).approximate, false);
  assert.deepEqual(compile(doc, sampled(doc, [0, 64, 128, 255], { Domain: [0, 1, 0, 1], Size: [2, 2] })).breakpoints, []);
});

test('stitching exposes narrow discontinuous bands missed by a uniform 4097-point grid', async () => {
  const doc = await PDFDocument.create();
  const constant = value => exp(doc, { C0: [value], C1: [value] });
  const fn = compile(doc, doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [0.50005, 0.50010],
    Encode: [0, 1, 0, 1, 0, 1], Functions: [constant(0), constant(1), constant(0)] }));
  assert.deepEqual(fn.breakpoints, [0.50005, 0.50010]);
  assert.equal(fn.approximate, false);
  close(fn([0.5]), [0]); close(fn([0.500075]), [1]); close(fn([0.50010]), [0]);
  assert(Array.from({ length: 4097 }, (_, i) => fn([i / 4096])[0]).every(value => value === 0), 'a uniform grid misses this entire band');
  const edges = [fn.domain[0], ...fn.breakpoints, fn.domain[1]];
  assert.deepEqual(edges.slice(1).map((end, i) => fn([(edges[i] + end) / 2])[0]), [0, 1, 0], 'split intervals retain the band');
});

test('nested stitching maps child boundaries through reversed Encode and clipping', async () => {
  const doc = await PDFDocument.create();
  const child = doc.context.obj({ FunctionType: 3, Domain: [10, 20], Bounds: [12, 17], Encode: [0, 1, 0, 1, 0, 1],
    Functions: [exp(doc), exp(doc), exp(doc)] });
  const mapped = compile(doc, doc.context.obj({ FunctionType: 3, Domain: [100, 200], Bounds: [], Encode: [20, 10], Functions: [child] }));
  assert.deepEqual(mapped.breakpoints, [130, 180]);
  const clipping = compile(doc, doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [], Encode: [-1, 2], Functions: [exp(doc)] }));
  close(clipping.breakpoints, [1 / 3, 2 / 3]);
  const constant = compile(doc, doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [], Encode: [15, 15], Functions: [child] }));
  assert.deepEqual(constant.breakpoints, []);
});

test('calculator literals are candidate breakpoints and approximation propagates through stitching and arrays', async () => {
  const doc = await PDFDocument.create();
  const scalar = calculator(doc, 'dup 0.50005 ge { pop 1 } { pop 0 } ifelse');
  const calc = compile(doc, scalar);
  assert.deepEqual(calc.breakpoints, [0.50005]); assert.equal(calc.approximate, true);
  const shifted = doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [0.5], Encode: [0, 1, 0, 1], Functions: [scalar, exp(doc)] });
  const stitched = compile(doc, shifted);
  close(stitched.breakpoints, [0.250025, 0.5]); assert.equal(stitched.approximate, true);
  const union = compile(doc, doc.context.obj([scalar, shifted, sampled(doc, [0, 128, 255], { Size: [3] })]));
  close(union.breakpoints, [0.250025, 0.5, 0.50005]); assert.equal(union.approximate, true);
  // Constants are hints only: arbitrary arithmetic can create a boundary that
  // is absent from the literal list, so the approximation flag must remain true.
  const computed = compile(doc, calculator(doc, 'dup 0.2 0.3 add gt { pop 1 } { pop 0 } ifelse'));
  assert.deepEqual(computed.breakpoints, [0.2, 0.3]); assert.equal(computed.approximate, true);
  close(computed([0.49]), [0]); close(computed([0.51]), [1]);
});

test('breakpoint unions reject excessive expansion instead of silently dropping boundaries', async () => {
  const doc = await PDFDocument.create();
  const dense = sampled(doc, new Uint8Array(4096), { Size: [4096] });
  const stitched = doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [0.2, 0.4, 0.6, 0.8],
    Encode: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], Functions: [dense, dense, dense, dense, dense] });
  assert.throws(() => compile(doc, stitched), /breakpoint limit exceeded/);
});

// Exact Type4 stream observed in Figma's swatches-SRGB.pdf (red→blue axial shading).
const figmaProgram = '1.000000 exch 0.000000 exch 0.000000 exch dup 0.000000 gt { exch pop exch pop exch pop dup 0.000000 sub -1.000000 mul 1.000000 add exch dup 0.000000 sub 0.000000 mul 0.000000 add exch dup 0.000000 sub 1.000000 mul 0.000000 add exch } if dup 1.000000 gt { exch pop exch pop exch pop 0.000000 exch 0.000000 exch 1.000000 exch } if pop';

test('native Figma calculator gradient retains exact red→blue samples and clipping', async () => {
  const doc = await PDFDocument.create(), f = compile(doc, calculator(doc, figmaProgram, 3, { Range: [0, 1, 0, 1, 0, 1] }));
  for (const t of [-1, 0, 0.1, 0.25, 0.5, 0.9, 1, 2]) { const v = Math.max(0, Math.min(1, t)); close(f([t]), [1 - v, 0, v]); }
  const fixture = path.join(__dirname, '../test-results/color-profiles/swatches-SRGB.pdf');
  if (fs.existsSync(fixture)) {
    const native = await PDFDocument.load(fs.readFileSync(fixture)); let checked = 0;
    for (const [, object] of native.context.enumerateIndirectObjects()) {
      const dict = object instanceof PDFRawStream ? object.dict : object;
      if (dict instanceof PDFDict && dict.get(PDFName.of('FunctionType'))?.asNumber() === 4) {
        const nativeFunction = compile(native, object);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) close(nativeFunction([t]), [1 - t, 0, t]);
        checked++;
      }
    }
    assert(checked > 0, 'the actual local native fixture was exercised');
  }
});

test('calculator arithmetic uses PostScript degrees, division, rounding and integer semantics', async () => {
  const doc = await PDFDocument.create();
  const cases = [
    ['3 4 add', 7], ['3 4 sub', -1], ['6 7 mul', 42], ['7 2 div', 3.5], ['7 -2 idiv', -3], ['-7 2 mod', -1],
    ['2 3 exp', 8], ['4 sqrt', 2], ['1 ln', 0], ['100 log', 2], ['-6.5 round', -6], ['-3.2 truncate', -3],
    ['-3.2 floor', -4], ['-3.2 ceiling', -3], ['-2 abs', 2], ['2 neg', -2], ['-3.2 cvi', -3], ['2 cvr', 2],
    ['90 sin', 1], ['180 cos', -1], ['1 0 atan', 90], ['-1 0 atan', 270], ['1 -1 atan', 135],
    ['2147483647 1 add', 2147483648], ['-2147483648 neg', 2147483648]
  ];
  for (const [body, expected] of cases) close(compile(doc, calculator(doc, `pop ${body}`))([0]), [expected]);
  for (const body of ['1 0 div', '1 0 idiv', '-1 sqrt', '0 ln', '0 0 atan', '2147483648 cvi', '-2147483648 -1 idiv', '2.0 1 idiv', '2 cvr 1 bitshift']) {
    assert.throws(() => compile(doc, calculator(doc, `pop ${body}`))([0]), /PDF function:/, body);
  }
});

test('calculator booleans, comparisons, conditional branches and bitwise operations are typed', async () => {
  const doc = await PDFDocument.create();
  for (const [body, expected] of [['true false or', 1], ['true false and', 0], ['true false xor', 1], ['true not', 0], ['2 2.0 eq', 1], ['2 3 ne', 1], ['2 3 lt', 1], ['3 3 le', 1], ['3 2 gt', 1], ['3 3 ge', 1]]) {
    close(compile(doc, calculator(doc, `pop ${body} { 1 } { 0 } ifelse`))([0]), [expected]);
  }
  for (const [body, expected] of [['6 3 and', 2], ['4 3 or', 7], ['6 3 xor', 5], ['0 not', -1], ['7 3 bitshift', 56], ['142 -3 bitshift', 17], ['-1 -1 bitshift', 2147483647], ['1 32 bitshift', 0], ['1 -32 bitshift', 0]]) {
    close(compile(doc, calculator(doc, `pop ${body}`))([0]), [expected]);
  }
  close(compile(doc, calculator(doc, 'dup 0.5 gt { 2 mul } { 0.5 mul } ifelse'))([0.8]), [1.6]);
  for (const body of ['1 { 2 } if', 'true 1 and', '1.0 2 xor', 'true not', 'true { 1 } dup']) {
    assert.throws(() => compile(doc, calculator(doc, `pop ${body}`))([0]), /PDF function:/, body);
  }
});

test('calculator stack operators copy, index and roll correctly in both directions', async () => {
  const doc = await PDFDocument.create();
  const cases = [
    ['1 dup', [1, 1]], ['1 2 exch', [2, 1]], ['1 2 0 copy', [1, 2]], ['1 2 2 copy', [1, 2, 1, 2]],
    ['1 2 1 index', [1, 2, 1]], ['1 2 3 3 1 roll', [3, 1, 2]], ['1 2 3 3 -1 roll', [2, 3, 1]], ['1 2 3 3 7 roll', [3, 1, 2]], ['1 0 5 roll', [1]]
  ];
  for (const [body, expected] of cases) close(compile(doc, calculator(doc, `pop ${body}`, expected.length))([0]), expected);
  for (const body of ['pop', '1 2 index', '1 -1 copy', '1 2 copy', '1 2 0.5 roll', '1 2 3 4 1 roll']) assert.throws(() => compile(doc, calculator(doc, `pop ${body}`))([0]), /PDF function:/);
});

test('calculator parser accepts PDF whitespace/comments and rejects executable or malformed syntax', async () => {
  const doc = await PDFDocument.create();
  close(compile(doc, calculator(doc, '% comment\n dup\x00 2 mul exch pop'))([0.4]), [0.8]);
  for (const body of ['1e2', '/name', '(string)', '[1 2]', 'currentfile', 'eval', 'while', 'exec', 'NaN', 'Infinity', 'true { 1 }', 'if', '{ 1 } { 2 } if', 'true { 1 } ifelse', '1 } { 2']) {
    assert.throws(() => compile(doc, calculator(doc, body)), /PDF function:/, body);
  }
  assert.throws(() => compile(doc, doc.context.stream('1 2 add', { FunctionType: 4, Domain: [0, 1], Range: [0, 1] })), /enclosed in braces/);
  assert.throws(() => compile(doc, calculator(doc, '1'))([0]), /expected 1/);
  assert.throws(() => compile(doc, calculator(doc, 'pop true'))([0]), /not numeric/);
});

test('bounded Flate streams decode correctly and reject corruption, predictors, filters and expansion bombs', async () => {
  const doc = await PDFDocument.create();
  const options = { FunctionType: 0, Domain: [0, 1], Range: [0, 1], Size: [2], BitsPerSample: 8 };
  const compressed = doc.context.flateStream(Uint8Array.from([0, 255]), options);
  close(compile(doc, compressed)([0.25]), [0.25]);
  const calc = doc.context.flateStream('{ 2 mul }', { FunctionType: 4, Domain: [0, 1], Range: [0, 2] });
  close(compile(doc, calc)([0.6]), [1.2]);
  const corrupted = PDFRawStream.of(calc.dict.clone(), calc.contents.slice()); corrupted.contents[corrupted.contents.length - 1] ^= 1;
  assert.throws(() => compile(doc, corrupted), /checksum/);
  const bomb = doc.context.flateStream(' '.repeat(65537), { FunctionType: 4, Domain: [0, 1], Range: [0, 1] });
  assert.throws(() => compile(doc, bomb), /stream exceeds/);
  const unsupported = sampled(doc, [0, 255]); unsupported.dict.set(PDFName.of('Filter'), PDFName.of('LZWDecode'));
  assert.throws(() => compile(doc, unsupported), /unsupported function stream filter/);
  const predicted = doc.context.flateStream(Uint8Array.from([0, 255]), { ...options, DecodeParms: { Predictor: 12 } });
  assert.throws(() => compile(doc, predicted), /predictors are unsupported/);
  const chain = doc.context.flateStream(Uint8Array.from([0, 255]), options); chain.dict.set(PDFName.of('Filter'), doc.context.obj(['FlateDecode', 'FlateDecode']));
  assert.throws(() => compile(doc, chain), /unsupported function stream filter/);
});

test('malformed sampled/stitching/exponential declarations fail explicitly', async () => {
  const doc = await PDFDocument.create();
  for (const options of [{ Size: [0] }, { Size: [2, 2] }, { BitsPerSample: 4 }, { Order: 3 }, { Encode: [0] }, { Decode: [0] }, { Domain: [1, 0] }, { Range: [1, 0] }, { Size: [4097] }]) {
    assert.throws(() => compile(doc, sampled(doc, [0, 255], options)), /PDF function:/);
  }
  assert.throws(() => compile(doc, sampled(doc, [0])), /data length/);
  assert.throws(() => compile(doc, sampled(doc, [0], { Domain: [0, 1, 0, 1, 0, 1], Size: [100, 100, 100] })), /grid limit/);
  for (const options of [{ C0: [], C1: [] }, { C0: [0, 0], C1: [1] }, { Range: [0, 1, 0, 1] }, { Domain: [0, 1, 0, 1] }]) assert.throws(() => compile(doc, exp(doc, options)), /PDF function:/);
  assert.throws(() => compile(doc, exp(doc, { Domain: [-1, 1], N: 0.5 }))([-1]), /non-finite/);
  const stitch = options => doc.context.obj({ FunctionType: 3, Domain: [0, 1], Functions: [exp(doc), exp(doc)], Bounds: [0.5], Encode: [0, 1, 0, 1], ...options });
  for (const options of [{ Bounds: [0] }, { Bounds: [1] }, { Bounds: [] }, { Encode: [0, 1] }, { Functions: [] }]) assert.throws(() => compile(doc, stitch(options)), /PDF function:/);
  assert.throws(() => compile(doc, doc.context.obj({ FunctionType: 99, Domain: [0, 1] })), /unsupported FunctionType/);
});

test('function graphs, calculator nesting, stack, token and aggregate execution have hard bounds', async () => {
  const doc = await PDFDocument.create();
  const cyclic = doc.context.obj({ FunctionType: 3, Domain: [0, 1], Bounds: [], Encode: [0, 1] });
  const ref = doc.context.register(cyclic); cyclic.set(PDFName.of('Functions'), doc.context.obj([ref]));
  assert.throws(() => compile(doc, ref), /cyclic function graph/);
  let nested = '1'; for (let i = 0; i < 34; i++) nested = `true { ${nested} } if`;
  assert.throws(() => compile(doc, calculator(doc, `pop ${nested}`)), /nesting limit/);
  assert.throws(() => compile(doc, calculator(doc, 'dup '.repeat(256)))([0]), /stack limit/);
  assert.throws(() => compile(doc, calculator(doc, 'dup pop '.repeat(5000))), /token limit/);
  const expensive = calculator(doc, 'dup pop '.repeat(4000));
  const all = compile(doc, doc.context.obj([expensive, expensive, expensive]));
  assert.throws(() => all([0.5]), /instruction limit/);
  // A failed evaluation does not poison the budget of a later call.
  close(compile(doc, exp(doc))([0.5]), [0.5]);
});
