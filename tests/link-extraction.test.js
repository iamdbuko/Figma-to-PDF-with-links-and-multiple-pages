const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const sourcePath = process.env.LINK_SOURCE || path.join(__dirname, '..', 'code.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('// Recursively scan nodes for prototype connections AND text hyperlinks');
  const end = source.indexOf('// ============================================================================', start);
  assert.ok(start >= 0 && end > start, 'link extraction section exists');
  const nodes = new Map();
  const sink = [];
  const context = vm.createContext({
    connections: sink,
    frameData: [],
    console: { log() {}, warn() {}, error() {} },
    figma: { getNodeByIdAsync: async id => nodes.get(id) || null }
  });
  vm.runInContext(source.slice(start, end), context);
  const frame = (id = 'page', width = 600, height = 800) => {
    const node = { id, type: 'FRAME', name: id, width, height, x: 0, y: 0, children: [] };
    nodes.set(id, node);
    return node;
  };
  const child = (parent, properties = {}) => {
    const node = { id: `node-${nodes.size}`, type: 'RECTANGLE', name: 'Website', x: 20, y: 30,
      width: 100, height: 24, ...properties, parent };
    (parent.children ||= []).push(node);
    nodes.set(node.id, node);
    return node;
  };
  const scan = async (node, root, roots = [root.id], target = sink) => {
    await context.scanNodeForConnections(node, root.id, 0, new Set(roots), target);
    return JSON.parse(JSON.stringify(target));
  };
  return { context, nodes, sink, frame, child, scan };
}

function urlReaction(url = 'https://one.example') {
  const action = { type: 'URL', url };
  return { trigger: { type: 'ON_CLICK' }, actions: [action], action };
}

test('reads modern action arrays, keeps legacy compatibility and deduplicates repeats', async () => {
  const h = harness();
  const page = h.frame();
  const modern = urlReaction();
  delete modern.action;
  const link = h.child(page, { reactions: [modern, modern,
    { action: { type: 'URL', url: 'https://two.example' } }] });
  const links = await h.scan(link, page);
  assert.deepEqual(links.map(item => item.toUrl), ['https://one.example', 'https://two.example']);
  assert.ok(links.every(item => item.source === 'prototype'));
});

test('accepts isolated connection arrays for concurrent export jobs', async () => {
  const h = harness();
  const page = h.frame();
  const link = h.child(page, { reactions: [urlReaction()] });
  const first = [], second = [];
  await Promise.all([h.scan(link, page, [page.id], first), h.scan(link, page, [page.id], second)]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(h.sink.length, 0);
  first.length = 0;
  await h.scan(link, page, [page.id], first);
  assert.equal(first.length, 1, 'a reused empty destination can be filled again');
});

test('skips hidden and zero-opacity layers including hidden ancestors', async () => {
  const h = harness();
  const page = h.frame();
  h.child(page, { visible: false, reactions: [urlReaction()] });
  h.child(page, { opacity: 0, reactions: [urlReaction()] });
  const group = h.child(page, { type: 'GROUP', visible: false, children: [] });
  const nested = h.child(group, { reactions: [urlReaction()] });
  assert.equal((await h.scan(page, page)).length, 0);
  assert.equal((await h.scan(nested, page)).length, 0);
});

test('composes ancestor and exported-frame rotation in native PDF export coordinates', async () => {
  const h = harness();
  const page = h.frame();
  page.relativeTransform = [[0, -1, 3000], [1, 0, 1000]];
  const group = h.child(page, { type: 'GROUP', x: 100, y: 50, width: 100, height: 100,
    relativeTransform: [[0, -1, 100], [1, 0, 50]], children: [] });
  const link = h.child(group, { x: 20, y: 10, width: 40, height: 20,
    relativeTransform: [[1, 0, 20], [0, 1, 10]], reactions: [urlReaction()] });
  const [result] = await h.scan(link, page);
  assert.deepEqual(result.elementBounds, { x: 690, y: 70, width: 40, height: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.getFrameExportBounds(page))),
    { x: 2200, y: 1000, width: 800, height: 600 });
});

test('uses absolute frame export bounds and world transform when provided by Figma', async () => {
  const h = harness();
  const page = h.frame();
  page.absoluteTransform = [[0, -1, 3000], [1, 0, 1000]];
  page.absoluteBoundingBox = { x: 2200, y: 1000, width: 800, height: 600 };
  const link = h.child(page, { x: 40, y: 60, width: 160, height: 40, reactions: [urlReaction()] });
  const [result] = await h.scan(link, page);
  assert.deepEqual(result.elementBounds, { x: 700, y: 40, width: 40, height: 160 });
});

test('includes transformed ancestors outside the exported source frame', async () => {
  const h = harness();
  const outer = h.frame('outer', 2000, 2000);
  outer.relativeTransform = [[2, 0, 100], [0, 2, 200]];
  const page = h.child(outer, { id: 'page', type: 'FRAME', x: 50, y: 60,
    width: 600, height: 800, children: [] });
  const link = h.child(page, { x: 40, y: 60, width: 160, height: 40, reactions: [urlReaction()] });
  const [result] = await h.scan(link, page);
  assert.deepEqual(result.elementBounds, { x: 80, y: 120, width: 320, height: 80 });
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.getFrameExportBounds(page))),
    { x: 200, y: 320, width: 1200, height: 1600 });
});

test('handles ancestor scaling and reflections', async () => {
  const h = harness();
  const page = h.frame();
  const group = h.child(page, { type: 'GROUP', relativeTransform: [[-2, 0, 300], [0, 3, 50]], children: [] });
  const link = h.child(group, { x: 20, y: 10, width: 40, height: 20, reactions: [urlReaction()] });
  const [result] = await h.scan(link, page);
  assert.deepEqual(result.elementBounds, { x: 180, y: 80, width: 80, height: 60 });
});

test('intersects clipping frames and skips entirely clipped links instead of moving them', async () => {
  const h = harness();
  const page = h.frame();
  const clip = h.child(page, { type: 'FRAME', x: 50, y: 50, width: 100, height: 100,
    clipsContent: true, children: [] });
  h.child(clip, { x: 80, y: 10, width: 50, height: 20, reactions: [urlReaction()] });
  h.child(clip, { x: 120, y: 60, width: 50, height: 20, reactions: [urlReaction('https://hidden.example')] });
  const links = await h.scan(page, page);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].elementBounds, { x: 130, y: 60, width: 20, height: 20 });
});

test('intersects rotated ancestor clipping polygons', async () => {
  const h = harness();
  const page = h.frame();
  const clip = h.child(page, { type: 'FRAME', width: 100, height: 100,
    relativeTransform: [[0, -1, 200], [1, 0, 50]], clipsContent: true, children: [] });
  const link = h.child(clip, { x: 80, y: 10, width: 50, height: 20, reactions: [urlReaction()] });
  const [result] = await h.scan(link, page);
  assert.deepEqual(result.elementBounds, { x: 170, y: 130, width: 20, height: 20 });
});

test('retains overflowing visible children of an unclipped off-page parent', async () => {
  const h = harness();
  const page = h.frame();
  const group = h.child(page, { type: 'FRAME', x: 700, y: 10, width: 50, height: 50, children: [] });
  h.child(group, { x: -200, y: 0, width: 50, height: 20, reactions: [urlReaction()] });
  const [result] = await h.scan(page, page);
  assert.deepEqual(result.elementBounds, { x: 500, y: 10, width: 50, height: 20 });
});

test('resolves descendant targets to selected exported roots and ignores unexported targets', async () => {
  const h = harness();
  const page = h.frame(), target = h.frame('destination'), unexported = h.frame('not-exported');
  const destinationText = h.child(target, { type: 'TEXT', id: 'destination-text' });
  const link = h.child(page, { reactions: [{ actions: [
    { type: 'NODE', destinationId: destinationText.id },
    { type: 'NODE', destinationId: unexported.id }
  ], action: { type: 'NODE', destinationId: destinationText.id } }] });
  const links = await h.scan(link, page, [page.id, target.id]);
  assert.equal(links.length, 1);
  assert.equal(links[0].toFrameId, target.id);
});

test('marks different links in one text layer for native geometry instead of inventing ranges', async () => {
  const h = harness();
  const page = h.frame();
  const text = h.child(page, { type: 'TEXT', characters: 'One Two', getStyledTextSegments() {
    return [
      { start: 0, end: 3, characters: 'One', hyperlink: { type: 'URL', value: 'https://one.example' } },
      { start: 4, end: 7, characters: 'Two', hyperlink: { type: 'URL', value: 'https://two.example' } }
    ];
  } });
  const links = await h.scan(text, page);
  assert.equal(links.length, 2);
  assert.ok(links.every(link => link.source === 'text' && link.needsTextGeometry === true));
  assert.deepEqual(links.map(link => [link.textStart, link.textEnd, link.textContent]), [[0, 3, 'One'], [4, 7, 'Two']]);
  assert.equal(h.context.getTextRangeBounds(text, page.id, 0, 3).length, 0);
});

test('whole-node text has safe fallback bounds and preserves non-web URI schemes', async () => {
  const h = harness();
  const page = h.frame();
  const text = h.child(page, { type: 'TEXT', characters: 'Email us',
    hyperlink: { type: 'URL', value: 'mailto:test@example.com' } });
  const [link] = await h.scan(text, page);
  assert.equal(link.needsTextGeometry, false);
  assert.equal(link.toUrl, 'mailto:test@example.com');
  assert.equal(link.source, 'text');
  assert.equal(h.context.getTextRangeBounds(text, page.id, 0, 8).length, 1);
});

test('text internal links retain the original node target for matching native annotations', async () => {
  const h = harness();
  const page = h.frame(), target = h.frame('destination');
  const destination = h.child(target, { id: '2:7' });
  const text = h.child(page, { type: 'TEXT', characters: 'Details',
    hyperlink: { type: 'NODE', value: destination.id } });
  const [link] = await h.scan(text, page, [page.id, target.id]);
  assert.equal(link.toFrameId, target.id);
  assert.equal(link.toNodeId, destination.id);
  assert.equal(link.source, 'text');
});
