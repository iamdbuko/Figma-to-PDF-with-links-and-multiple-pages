const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const messages = [], exports = [], nodes = new Map(), events = new Map(), timers = new Map(), pageEvents = new Map();
  let nextTimer = 0;
  const figma = {
    mixed: Symbol('mixed'),
    root: { documentColorProfile: 'documentColorProfile' in options ? options.documentColorProfile : 'SRGB' },
    showUI() {},
    ui: { postMessage(message) { messages.push(structuredClone(message)); } },
    on(event, callback) { events.set(event, callback); },
    off(event, callback) { if (events.get(event) === callback) events.delete(event); },
    currentPage: { type: 'PAGE', selection: [],
      on(event, callback) { pageEvents.set(event, callback); },
      off(event, callback) { if (pageEvents.get(event) === callback) pageEvents.delete(event); }
    },
    getNodeByIdAsync: async id => nodes.get(id) || null,
    closePlugin() { throw new Error('Export cancellation must not close the plugin'); }
  };
  const context = vm.createContext({
    figma, __html__: '', Uint8Array,
    console: { log() {}, warn() {}, error() {} },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  let source = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
  // Exercise byte-limit edges without allocating hundreds of megabytes in tests.
  if (options.maxPageTransferBytes !== undefined) {
    source = source.replace('maxPageTransferBytes: 128 * 1024 * 1024', `maxPageTransferBytes: ${options.maxPageTransferBytes}`);
  }
  vm.runInContext(source, context);
  const frame = (id, properties = {}) => {
    const node = {
      id, name: id, type: 'FRAME', width: 600, height: 800, x: 0, y: 0,
      visible: true, opacity: 1, fills: [], strokes: [], effects: [], children: [],
      ...properties
    };
    node.exportAsync = async settings => {
      exports.push(structuredClone({ id, ...settings }));
      return properties.exporter ? properties.exporter(settings) : new Uint8Array([1, 2, 3, 4]);
    };
    nodes.set(id, node);
    return node;
  };
  const child = (parent, properties = {}) => {
    const node = { id: `child-${nodes.size}`, name: 'Link', type: 'RECTANGLE', x: 20, y: 30,
      width: 100, height: 40, visible: true, ...properties, parent };
    parent.children.push(node);
    nodes.set(node.id, node);
    return node;
  };
  const send = message => figma.ui.onmessage(message);
  const start = (ids, options = {}) => send({ type: 'export-pdf', jobId: 'job-1', frameOrder: ids,
    selectedFrames: ids, qualityScale: 1, quality: 'high', exportType: 'vector', ...options });
  const messagesOf = type => messages.filter(message => message.type === type);
  const ack = (index, options = {}) => send({ type: 'page-ack', jobId: 'job-1', index, ...options });
  return { messages, exports, nodes, events, pageEvents, timers, figma, context, frame, child, send, start, ack, messagesOf };
}

const urlReaction = url => ({ actions: [{ type: 'URL', url }] });

function textLink(h, frame) {
  return h.child(frame, { type: 'TEXT', characters: 'One link', hyperlink: { type: 'URL', value: 'https://example.com' } });
}

test('deduplicates ordered IDs and waits for each ACK before exporting another page', async () => {
  const h = harness(); h.frame('a'); h.frame('b'); h.frame('unused');
  await h.start(['b', 'a', 'b', 'unused'], { selectedFrames: ['a', 'b', 'b'] });
  assert.deepEqual(h.messagesOf('export-start')[0].frames.map(frame => frame.id), ['b', 'a']);
  assert.deepEqual(h.exports.map(item => item.id), ['b']);
  await h.ack(1); await h.ack(0, { jobId: 'stale' });
  assert.equal(h.exports.length, 1);
  await h.ack(0);
  assert.deepEqual(h.exports.map(item => item.id), ['b', 'a']);
  await h.ack(0);
  assert.equal(h.exports.length, 2);
  await h.ack(1);
  assert.equal(h.messagesOf('export-complete').length, 1);
  await h.start(['a'], { jobId: 'too-soon' });
  assert.match(h.messagesOf('export-error').at(-1).error, /Another export/);
  await h.send({ type: 'export-finished', jobId: 'job-1' });
  await h.start(['a'], { jobId: 'job-2' });
  assert.equal(h.exports.length, 3);
  assert.ok(h.exports.every(item => item.useAbsoluteBounds === true));
});

test('uses current dimensions and rescans changed links at export preflight', async () => {
  const h = harness(), frame = h.frame('a', { width: 300, height: 200 });
  const link = h.child(frame, { reactions: [urlReaction('https://old.example')] });
  h.figma.currentPage.selection = [frame];
  await h.events.get('selectionchange')();
  frame.width = 600; frame.height = 300; frame.name = 'Resized';
  link.x = 70; link.reactions = [urlReaction('https://new.example')];
  await h.start(['a']);
  const start = h.messagesOf('export-start')[0];
  assert.deepEqual(start.frames.map(({ width, height, name }) => ({ width, height, name })), [{ width: 600, height: 300, name: 'Resized' }]);
  assert.equal(start.connections.length, 1);
  assert.equal(start.connections[0].toUrl, 'https://new.example');
  assert.equal(start.connections[0].elementBounds.x, 70);
});

test('retries one PDF as PNG at the same index and preserves precise text annotation bytes', async () => {
  const h = harness(), frame = h.frame('a'); h.frame('b'); textLink(h, frame);
  await h.start(['a', 'b']);
  const native = h.messagesOf('export-page')[0].data;
  await h.ack(0, { fallback: true });
  const pages = h.messagesOf('export-page');
  assert.deepEqual(pages.map(page => [page.index, page.format]), [[0, 'PDF'], [0, 'PNG']]);
  assert.deepEqual(pages[1].annotationPdfData, native);
  assert.deepEqual(h.exports.map(item => item.format), ['PDF', 'PNG']);
  await h.ack(0, { fallback: true }); // Duplicate fallback must not trigger another export.
  assert.equal(h.exports.length, 2);
  await h.ack(0);
  assert.equal(h.messagesOf('export-page').at(-1).index, 1);
});

test('native export failure falls back once, reports text geometry loss, and does not hide any nodes', async () => {
  const h = harness(), frame = h.frame('a', {
    exporter(settings) { if (settings.format === 'PDF') throw new Error('native failed'); return new Uint8Array([9]); }
  });
  textLink(h, frame);
  const protectedFrame = new Proxy(frame, { set() { throw new Error('Source frame was mutated'); } });
  h.nodes.set('a', protectedFrame);
  await h.start(['a']);
  const page = h.messagesOf('export-page')[0];
  assert.equal(page.format, 'PNG');
  assert.match(page.warnings.join(' '), /native failed/);
  assert.match(page.warnings.join(' '), /Precise text links/);
  assert.equal(page.annotationPdfData, undefined);
  assert.deepEqual(h.exports.map(item => item.format), ['PDF', 'PNG']);
});

test('raster pages fetch native PDF only when text annotations are needed', async () => {
  const h = harness(), frame = h.frame('with-link'); textLink(h, frame); h.frame('plain');
  await h.start(['with-link', 'plain'], { exportType: 'raster' });
  assert.deepEqual(h.exports.map(item => item.format), ['PNG', 'PDF']);
  assert.ok(h.messagesOf('export-page')[0].annotationPdfData);
  await h.ack(0);
  assert.deepEqual(h.exports.map(item => item.format), ['PNG', 'PDF', 'PNG']);
  assert.equal(h.messagesOf('export-page')[1].annotationPdfData, undefined);
});

test('auxiliary annotation failure warns without discarding a valid raster page', async () => {
  const h = harness(), frame = h.frame('a', {
    exporter(settings) { if (settings.format === 'PDF') throw new Error('annotation unavailable'); return new Uint8Array([9]); }
  });
  textLink(h, frame);
  await h.start(['a'], { exportType: 'raster' });
  assert.equal(h.messagesOf('export-error').length, 0);
  assert.equal(h.messagesOf('export-page')[0].format, 'PNG');
  assert.equal(h.messagesOf('export-page')[0].annotationPdfData, undefined);
  assert.match(h.messagesOf('export-page')[0].warnings.join(' '), /annotation unavailable/);
});

test('Plus lighter and Plus darker on nodes, paints and effects use whole-frame PNG', async () => {
  const h = harness();
  h.frame('node', { blendMode: 'LINEAR_DODGE' });
  h.frame('paint', { fills: [{ type: 'SOLID', blendMode: 'LINEAR_BURN' }] });
  h.frame('effect', { effects: [{ type: 'DROP_SHADOW', blendMode: 'LINEAR_DODGE' }] });
  h.frame('hidden', { effects: [{ visible: false, blendMode: 'LINEAR_DODGE' }] });
  await h.start(['node', 'paint', 'effect', 'hidden']);
  await h.ack(0); await h.ack(1); await h.ack(2);
  assert.deepEqual(h.messagesOf('export-page').map(page => page.format), ['PNG', 'PNG', 'PNG', 'PDF']);
  assert.match(h.messagesOf('export-page')[0].warnings[0], /Plus lighter/);
  assert.match(h.messagesOf('export-page')[1].warnings[0], /Plus darker/);
});

test('raster preflight rejects an oversized later page before exporting any page', async () => {
  const h = harness(); h.frame('small'); h.frame('huge', { width: 9000, height: 4000 });
  await h.start(['small', 'huge'], { exportType: 'raster' });
  assert.equal(h.exports.length, 0);
  assert.match(h.messagesOf('export-error')[0].error, /32 million pixels/);
  assert.equal(h.messagesOf('export-start').length, 0);
});

test('raster guard also applies to fallback and does not silently lower requested quality', async () => {
  const h = harness(); h.frame('a', { width: 9000, height: 4000 });
  await h.start(['a']);
  await h.ack(0, { fallback: true });
  assert.deepEqual(h.exports.map(item => item.format), ['PDF']);
  assert.match(h.messagesOf('export-error')[0].error, /Lower the quality/);
});

test('cancel during native export waits for its result, emits no page, and blocks overlap', async () => {
  const h = harness(), rendering = deferred();
  h.frame('a', { exporter: () => rendering.promise });
  const startPromise = h.start(['a']);
  while (!h.exports.length) await new Promise(resolve => setImmediate(resolve));
  await h.send({ type: 'export-cancel', jobId: 'job-1' });
  assert.equal(h.messagesOf('export-cancelled').length, 0);
  await h.start(['a'], { jobId: 'job-2' });
  assert.match(h.messagesOf('export-error')[0].error, /Another export/);
  rendering.resolve(new Uint8Array([1]));
  await startPromise;
  assert.equal(h.messagesOf('export-page').length, 0);
  assert.equal(h.messagesOf('export-cancelled').length, 1);
  await h.ack(0);
  assert.equal(h.messagesOf('export-complete').length, 0);
});

test('cancel during frame lookup stops preflight before scanning or exporting', async () => {
  const h = harness(), frame = h.frame('a'), lookup = deferred();
  h.figma.getNodeByIdAsync = () => lookup.promise;
  const start = h.start(['a']);
  await h.send({ type: 'export-cancel', jobId: 'job-1' });
  lookup.resolve(frame); await start;
  assert.equal(h.exports.length, 0);
  assert.equal(h.messagesOf('export-start').length, 0);
  assert.equal(h.messagesOf('export-cancelled').length, 1);
});

test('UI failure cancels pending job and stale messages cannot start later pages', async () => {
  const h = harness(); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  await h.send({ type: 'export-failed', jobId: 'job-1', message: 'Bad output' });
  assert.match(h.messagesOf('export-error')[0].error, /Bad output/);
  await h.ack(0);
  assert.equal(h.exports.length, 1);
  await h.start(['a'], { jobId: 'job-2' });
  await h.send({ type: 'export-cancel', jobId: 'job-1' });
  assert.equal(h.messagesOf('export-cancelled').length, 0);
});

test('ACK timeout releases the job and unfinished page never advances', async () => {
  const h = harness(); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.ms, 120000);
  timer.fn();
  assert.match(h.messagesOf('export-error')[0].error, /acknowledge page 1/);
  assert.equal(h.timers.size, 0);
  await h.ack(0);
  assert.equal(h.exports.length, 1);
});

test('per-page budget includes fallback data and auxiliary annotation PDFs', async () => {
  const h = harness({ maxPageTransferBytes: 7 }), frame = h.frame('a'); textLink(h, frame);
  await h.start(['a']);
  await h.ack(0, { fallback: true }); // 4 bytes PNG + 4 bytes annotation PDF cannot fit.
  assert.match(h.messagesOf('export-error')[0].error, /128 MiB/);
  assert.match(h.messagesOf('export-error')[0].error, /per-page/);
  assert.equal(h.messagesOf('export-page').length, 1);
  assert.equal(h.messagesOf('export-complete').length, 0);
});

test('previous pages and discarded retries do not consume the next page transfer allowance', async () => {
  const h = harness({ maxPageTransferBytes: 4 }); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  await h.ack(0, { fallback: true });
  await h.ack(0);
  await h.ack(1);
  assert.deepEqual(h.messagesOf('export-page').map(page => page.format), ['PDF', 'PNG', 'PDF']);
  assert.equal(h.messagesOf('export-error').length, 0);
  assert.equal(h.messagesOf('export-complete').length, 1);
  assert.equal(vm.runInContext('activeExportJob.transferredBytes', h.context), 12);
});

test('JPEG raster exports request sRGB and still obtain native text annotations', async () => {
  const h = harness(), frame = h.frame('a'); textLink(h, frame);
  await h.start(['a'], { exportType: 'raster', rasterFormat: 'JPG', qualityScale: 1.5 });
  assert.deepEqual(h.exports, [
    { id: 'a', format: 'JPG', useAbsoluteBounds: true, constraint: { type: 'SCALE', value: 1.5 }, colorProfile: 'SRGB' },
    { id: 'a', format: 'PDF', useAbsoluteBounds: true, colorProfile: 'SRGB' }
  ]);
  assert.equal(h.messagesOf('export-page')[0].format, 'JPG');
  assert.ok(h.messagesOf('export-page')[0].annotationPdfData);
});

test('native failure, unsupported blending and merge fallback all respect JPEG selection', async () => {
  const h = harness();
  h.frame('native-failure', { exporter(settings) {
    if (settings.format === 'PDF') throw new Error('Cannot render PDF');
    return new Uint8Array([1]);
  } });
  h.frame('blend', { blendMode: 'LINEAR_BURN' });
  h.frame('merge-failure');
  await h.start(['native-failure', 'blend', 'merge-failure'], { rasterFormat: 'JPG' });
  await h.ack(0); await h.ack(1); await h.ack(2, { fallback: true });
  assert.deepEqual(h.messagesOf('export-page').map(page => page.format), ['JPG', 'JPG', 'PDF', 'JPG']);
  assert.ok(h.exports.filter(item => item.format === 'JPG').every(item => item.colorProfile === 'SRGB'));
  await h.ack(2, { fallback: true });
  assert.equal(h.exports.length, 5);
});

test('explicit fitting respects rounded pixel and side limits without changing PDF dimensions', async () => {
  const h = harness();
  h.frame('square', { width: 6000, height: 6000 });
  h.frame('wide', { width: 100000, height: 10 });
  h.frame('small', { width: 100, height: 200 });
  await h.start(['square', 'wide', 'small'], { exportType: 'raster', rasterFormat: 'JPG', qualityScale: 2, fitOversized: true });
  await h.ack(0); await h.ack(1);
  const pages = h.messagesOf('export-page');
  assert.equal(h.messagesOf('export-error').length, 0);
  for (let i = 0; i < pages.length; i++) {
    const frame = pages[i].frame, scale = h.exports[i].constraint.value;
    const width = Math.ceil(frame.width * scale), height = Math.ceil(frame.height * scale);
    assert.ok(width * height <= 32000000);
    assert.ok(width <= 16384 && height <= 16384);
    assert.ok(scale <= 2);
  }
  assert.deepEqual(pages.map(page => [page.frame.width, page.frame.height]), [[6000, 6000], [100000, 10], [100, 200]]);
  assert.match(pages[0].warnings.join(' '), /requested 2×, actual .*PDF page dimensions are unchanged/);
  assert.match(pages[1].warnings.join(' '), /16384×2 pixels/);
  assert.equal(h.exports[2].constraint.value, 2);
  assert.deepEqual(pages[2].warnings, []);
});

test('fitting is also applied when a large native PDF needs raster fallback', async () => {
  const h = harness(); h.frame('a', { width: 9000, height: 4000 });
  await h.start(['a'], { rasterFormat: 'JPG', qualityScale: 2, fitOversized: true });
  await h.ack(0, { fallback: true });
  assert.deepEqual(h.exports.map(item => item.format), ['PDF', 'JPG']);
  const scale = h.exports[1].constraint.value;
  assert.ok(Math.ceil(9000 * scale) * Math.ceil(4000 * scale) <= 32000000);
  assert.match(h.messagesOf('export-page')[1].warnings.join(' '), /was fitted/);
});

test('invalid raster format and non-boolean fitting options fail before rendering', async () => {
  const h = harness(); h.frame('a');
  await h.start(['a'], { rasterFormat: 'JPEG' });
  assert.match(h.messagesOf('export-error')[0].error, /PNG or JPG/);
  await h.start(['a'], { jobId: 'job-2', fitOversized: 'false' });
  assert.match(h.messagesOf('export-error')[1].error, /enabled or disabled/);
  assert.equal(h.exports.length, 0);
});

test('part-ready pauses only the pending job, releases native bytes and resumes at the next page', async () => {
  const h = harness(); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  const originalTimer = [...h.timers.keys()][0];
  await h.send({ type: 'part-ready', jobId: 'stale', index: 0 });
  await h.send({ type: 'part-ready', jobId: 'job-1', index: 1 });
  assert.deepEqual([...h.timers.keys()], [originalTimer]);
  await h.send({ type: 'part-ready', jobId: 'job-1', index: 0 });
  assert.equal(h.exports.length, 1);
  assert.equal(h.timers.size, 1);
  const pauseTimer = [...h.timers.keys()][0];
  assert.equal([...h.timers.values()][0].ms, 15 * 60 * 1000);
  assert.equal(vm.runInContext('activeExportJob.phase', h.context), 'awaiting-part');
  assert.equal(vm.runInContext('activeExportJob.pending.nativePdfData', h.context), null);
  assert.ok(h.pageEvents.has('nodechange'));
  await h.send({ type: 'part-ready', jobId: 'job-1', index: 0 });
  await h.ack(0, { fallback: true });
  await h.ack(1);
  assert.equal(h.exports.length, 1);
  assert.deepEqual([...h.timers.keys()], [pauseTimer]);
  await h.ack(0);
  assert.deepEqual(h.exports.map(item => item.id), ['a', 'b']);
  assert.equal([...h.timers.values()][0].ms, 120000);
  await h.ack(0);
  assert.equal(h.exports.length, 2);
});

test('a paused part expires and stale continuation cannot start another page', async () => {
  const h = harness(); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  await h.send({ type: 'part-ready', jobId: 'job-1', index: 0 });
  [...h.timers.values()][0].fn();
  assert.match(h.messagesOf('export-error')[0].error, /15 minutes/);
  await h.ack(0);
  assert.equal(h.exports.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.pageEvents.size, 0);
});

test('source changes, cancellation and UI failure remain effective while a part is paused', async () => {
  for (const action of ['source-change', 'export-cancel', 'export-failed']) {
    const h = harness(); h.frame('a'); h.frame('b');
    await h.start(['a', 'b']);
    await h.send({ type: 'part-ready', jobId: 'job-1', index: 0 });
    if (action === 'source-change') h.pageEvents.get('nodechange')({ nodeChanges: [] });
    else await h.send({ type: action, jobId: 'job-1', error: 'Save failed' });
    const expected = action === 'export-cancel' ? 'export-cancelled' : 'export-error';
    assert.equal(h.messagesOf(expected).length, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.pageEvents.size, 0);
    await h.ack(0);
    assert.equal(h.exports.length, 1);
  }
});

test('active export freezes list additions and changed dimensions abort before rendering', async () => {
  const h = harness(), a = h.frame('a'), b = h.frame('b'); h.frame('new');
  await h.start(['a', 'b']);
  h.figma.currentPage.selection = [h.nodes.get('new')];
  await h.events.get('selectionchange')();
  assert.equal(h.messagesOf('frames-updated').length, 0);
  b.width = 700;
  await h.ack(0);
  assert.match(h.messagesOf('export-error')[0].error, /changed size/);
  assert.deepEqual(h.exports.map(item => item.id), [a.id]);
});

test('invalid selection, missing frames and reused IDs fail explicitly', async () => {
  const h = harness(); h.frame('a');
  await h.start(['a'], { selectedFrames: ['a', 'missing'] });
  assert.match(h.messagesOf('export-error').at(-1).error, /missing from the page order/);
  await h.start(['missing'], { jobId: 'job-2' });
  assert.match(h.messagesOf('export-error').at(-1).error, /no longer available/);
  await h.start(['a'], { jobId: 'job-1' });
  assert.match(h.messagesOf('export-error').at(-1).error, /already finished/);
  assert.equal(h.exports.length, 0);
});

test('rotated frames use their exported world bounding-box dimensions', async () => {
  const h = harness();
  h.frame('rotated', { width: 600, height: 800,
    absoluteTransform: [[0, -1, 1200], [1, 0, 300]],
    absoluteBoundingBox: { x: 400, y: 300, width: 800, height: 600 }
  });
  await h.start(['rotated'], { exportType: 'raster' });
  const page = h.messagesOf('export-page')[0];
  assert.deepEqual({ width: page.frame.width, height: page.frame.height }, { width: 800, height: 600 });
  assert.equal(h.messagesOf('export-error').length, 0);
});

test('page edits between ACKs abort instead of combining stale links with changed designs', async () => {
  const h = harness(); h.frame('a'); h.frame('b');
  await h.start(['a', 'b']);
  h.pageEvents.get('nodechange')({ nodeChanges: [{ type: 'PROPERTY_CHANGE', id: 'b', properties: ['characters'] }] });
  assert.match(h.messagesOf('export-error')[0].error, /design changed/);
  await h.ack(0);
  assert.equal(h.exports.length, 1);
  assert.equal(h.pageEvents.size, 0);
  assert.equal(h.events.has('stylechange'), false);
});

test('style edits during native rendering stop the result; source watchers end before save', async () => {
  const h = harness(), rendering = deferred();
  h.frame('a', { exporter: () => rendering.promise });
  const start = h.start(['a']);
  while (!h.exports.length) await new Promise(resolve => setImmediate(resolve));
  h.events.get('stylechange')({ styleChanges: [{ type: 'STYLE_PROPERTY_CHANGE' }] });
  rendering.resolve(new Uint8Array([1])); await start;
  assert.equal(h.messagesOf('export-page').length, 0);
  assert.match(h.messagesOf('export-error')[0].error, /design changed/);
  await h.start(['a'], { jobId: 'job-2' });
  await h.ack(0, { jobId: 'job-2' });
  assert.equal(h.messagesOf('export-complete').length, 1);
  assert.equal(h.pageEvents.size, 0);
  assert.equal(h.events.has('stylechange'), false);
});

test('the default export profile is explicit sRGB even in a Display P3 document', async () => {
  const h = harness({ documentColorProfile: 'DISPLAY_P3' }); h.frame('a');
  await h.start(['a']);
  assert.equal(h.messagesOf('export-start')[0].exportColorProfile, 'SRGB');
  assert.equal(h.messagesOf('export-page')[0].exportColorProfile, 'SRGB');
  assert.equal(h.exports[0].colorProfile, 'SRGB');
});

test('explicit RGB profiles reach native PDFs, both raster formats, annotation PDFs and merge retries', async () => {
  for (const colorProfile of ['SRGB', 'DISPLAY_P3_V4']) {
    for (const rasterFormat of ['PNG', 'JPG']) {
      for (const exportType of ['vector', 'raster']) {
        const h = harness({ documentColorProfile: 'LEGACY' }), frame = h.frame('a');
        textLink(h, frame);
        await h.start(['a'], { colorProfile, rasterFormat, exportType });
        if (exportType === 'vector') await h.ack(0, { fallback: true });
        assert.equal(h.messagesOf('export-error').length, 0);
        assert.ok(h.exports.every(item => item.colorProfile === colorProfile));
        assert.equal(h.messagesOf('export-start')[0].exportColorProfile, colorProfile);
        assert.ok(h.messagesOf('export-page').every(page => page.exportColorProfile === colorProfile));
        assert.equal(h.messagesOf('export-page').at(-1).format, rasterFormat);
        assert.ok(h.messagesOf('export-page').at(-1).annotationPdfData);
        assert.deepEqual(h.exports.map(item => item.format), exportType === 'vector' ? ['PDF', rasterFormat] : [rasterFormat, 'PDF']);
      }
    }
  }
});

test('native rendering failure and unsupported blending preserve the selected P3 profile', async () => {
  for (const rasterFormat of ['PNG', 'JPG']) {
    const h = harness();
    h.frame('failure', { exporter(settings) {
      if (settings.format === 'PDF') throw new Error('Native PDF unavailable');
      return new Uint8Array([1]);
    } });
    h.frame('blend', { blendMode: 'LINEAR_DODGE' });
    await h.start(['failure', 'blend'], { colorProfile: 'DISPLAY_P3_V4', rasterFormat });
    await h.ack(0);
    assert.deepEqual(h.exports.map(item => item.format), ['PDF', rasterFormat, rasterFormat]);
    assert.ok(h.exports.every(item => item.colorProfile === 'DISPLAY_P3_V4'));
    assert.ok(h.messagesOf('export-page').every(page => page.exportColorProfile === 'DISPLAY_P3_V4'));
  }
});

test('document profiles resolve once to a concrete profile shared by every message and export', async () => {
  for (const [documentColorProfile, resolved] of [['SRGB', 'SRGB'], ['DISPLAY_P3', 'DISPLAY_P3_V4']]) {
    const h = harness({ documentColorProfile }); h.frame('a'); h.frame('b');
    await h.start(['a', 'b'], { colorProfile: 'DOCUMENT', exportType: 'raster' });
    await h.ack(0);
    assert.equal(vm.runInContext('activeExportJob.sourceColorProfile', h.context), documentColorProfile);
    assert.equal(vm.runInContext('activeExportJob.exportColorProfile', h.context), resolved);
    assert.equal(h.messagesOf('export-start')[0].exportColorProfile, resolved);
    assert.ok(h.exports.every(item => item.colorProfile === resolved));
    assert.ok(h.messagesOf('export-page').every(page => page.exportColorProfile === resolved));
  }
});

test('legacy documents require an explicit export choice rather than a guessed document profile', async () => {
  const h = harness({ documentColorProfile: 'LEGACY' }); h.frame('a');
  await h.start(['a'], { colorProfile: 'DOCUMENT' });
  assert.match(h.messagesOf('export-error')[0].error, /legacy document.*Choose sRGB or Display P3/);
  assert.equal(h.exports.length, 0);
  assert.equal(h.messagesOf('export-start').length, 0);
});

test('invalid choices and unavailable document profiles fail before exporting any pixels', async () => {
  for (const colorProfile of ['CMYK', 'DISPLAY_P3', '', null, 42]) {
    const h = harness(); h.frame('a');
    await h.start(['a'], { colorProfile });
    assert.match(h.messagesOf('export-error')[0].error, /Choose sRGB, Display P3/);
    assert.equal(h.exports.length, 0);
  }
  for (const documentColorProfile of ['ADOBE_RGB', '', null, undefined]) {
    const h = harness({ documentColorProfile }); h.frame('a');
    await h.start(['a']);
    assert.match(h.messagesOf('export-error')[0].error, /document color profile is unavailable or unsupported/);
    assert.equal(h.exports.length, 0);
  }
});

test('a document-profile change during preflight aborts before emitting export-start', async () => {
  const h = harness(), frame = h.frame('a'), lookup = deferred();
  h.figma.getNodeByIdAsync = () => lookup.promise;
  const started = h.start(['a'], { colorProfile: 'DOCUMENT' });
  h.figma.root.documentColorProfile = 'DISPLAY_P3';
  lookup.resolve(frame); await started;
  assert.match(h.messagesOf('export-error')[0].error, /color profile changed/);
  assert.equal(h.messagesOf('export-start').length, 0);
  assert.equal(h.exports.length, 0);
});

test('profile changes during native PDF awaits cannot be swallowed by raster fallback', async () => {
  for (const reject of [false, true]) {
    const h = harness(), rendered = deferred();
    h.frame('a', { exporter: () => rendered.promise });
    const started = h.start(['a']);
    while (!h.exports.length) await new Promise(resolve => setImmediate(resolve));
    h.figma.root.documentColorProfile = 'DISPLAY_P3';
    if (reject) rendered.reject(new Error('Native failure'));
    else rendered.resolve(new Uint8Array([1]));
    await started;
    assert.match(h.messagesOf('export-error')[0].error, /color profile changed/);
    assert.deepEqual(h.exports.map(item => item.format), ['PDF']);
    assert.equal(h.messagesOf('export-page').length, 0);
  }
});

test('profile changes during raster or auxiliary annotation exports discard the page', async () => {
  for (const changedFormat of ['PNG', 'PDF']) {
    const h = harness(), frame = h.frame('a', { exporter(settings) {
      if (settings.format === changedFormat) h.figma.root.documentColorProfile = 'DISPLAY_P3';
      return new Uint8Array([1]);
    } });
    textLink(h, frame);
    await h.start(['a'], { exportType: 'raster' });
    assert.match(h.messagesOf('export-error')[0].error, /color profile changed/);
    assert.equal(h.messagesOf('export-page').length, 0);
    assert.deepEqual(h.exports.map(item => item.format), changedFormat === 'PNG' ? ['PNG'] : ['PNG', 'PDF']);
  }
});

test('document-profile changes are checked before continuing a part and before final completion', async () => {
  for (const paused of [false, true]) {
    const h = harness(); h.frame('a'); h.frame('b');
    await h.start(paused ? ['a', 'b'] : ['a']);
    if (paused) await h.send({ type: 'part-ready', jobId: 'job-1', index: 0 });
    h.figma.root.documentColorProfile = 'DISPLAY_P3';
    await h.ack(0);
    assert.match(h.messagesOf('export-error')[0].error, /color profile changed/);
    assert.equal(h.exports.length, 1);
    assert.equal(h.messagesOf('export-complete').length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('existing source-change events report changed document profiles and clear the job', async () => {
  const h = harness(); h.frame('a');
  await h.start(['a']);
  h.figma.root.documentColorProfile = 'DISPLAY_P3';
  h.events.get('stylechange')({ styleChanges: [] });
  assert.match(h.messagesOf('export-error')[0].error, /color profile changed/);
  assert.equal(h.pageEvents.size, 0);
  assert.equal(h.events.has('stylechange'), false);
});
