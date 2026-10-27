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

function harness() {
  const messages = [], exports = [], nodes = new Map(), events = new Map(), timers = new Map(), pageEvents = new Map();
  let nextTimer = 0;
  const figma = {
    mixed: Symbol('mixed'),
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8'), context);
  const frame = (id, properties = {}) => {
    const node = {
      id, name: id, type: 'FRAME', width: 600, height: 800, x: 0, y: 0,
      visible: true, opacity: 1, fills: [], strokes: [], effects: [], children: [],
      ...properties
    };
    node.exportAsync = async settings => {
      exports.push({ id, ...settings });
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

test('transfer budget includes retried page data and auxiliary annotation PDFs', async () => {
  const h = harness(), frame = h.frame('a'); textLink(h, frame);
  await h.start(['a']);
  vm.runInContext('activeExportJob.transferredBytes = EXPORT_LIMITS.maxTransferBytes - 7', h.context);
  await h.ack(0, { fallback: true }); // 4 bytes PNG + 4 bytes annotation PDF cannot fit.
  assert.match(h.messagesOf('export-error')[0].error, /128 MiB/);
  assert.equal(h.messagesOf('export-page').length, 1);
  assert.equal(h.messagesOf('export-complete').length, 0);
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
