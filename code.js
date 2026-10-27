// Figma PDF export: whole-frame rendering, one acknowledged page at a time.
// Keep output color mode separate from Figma's rendering profile. Legacy file
// colors stay DOCUMENT; the assembler reads each page's actual color metadata.
figma.showUI(__html__, { width: 400, height: 600 });

let frameData = [];
let connections = [];
let activeExportJob = null;
let listRevision = 0;
const usedJobIds = new Set();

// Provisional v9 safety limits. Raster pixels are measured after scaling.
// The transfer cap includes a page's annotation PDF and any color-profile probe,
// not historical traffic. CMYK beta uses 8 MP to bound conversion buffers.
// The UI separately bounds retained PDF resources and saves parts.
// Optional fitting changes raster resolution only, never PDF page dimensions.
const EXPORT_LIMITS = Object.freeze({
  maxRasterPixels: 32000000,
  maxCmykRasterPixels: 8000000,
  maxRasterSide: 16384,
  maxPageTransferBytes: 128 * 1024 * 1024,
  acknowledgementTimeoutMs: 120000,
  partContinuationTimeoutMs: 15 * 60 * 1000,
  finishTimeoutMs: 120000
});

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'ui-ready') {
    // The UI may finish loading after the initial selection was scanned.
    sendFrameList([]);
  } else if (msg.type === 'export-pdf') {
    await startExport(msg);
  } else if (msg.type === 'page-ack') {
    await acknowledgePage(msg);
  } else if (msg.type === 'part-ready') {
    pauseForSavedPart(msg);
  } else if (msg.type === 'export-cancel') {
    const job = matchingJob(msg.jobId);
    if (job) terminateJob(job, 'export-cancelled');
  } else if (msg.type === 'export-failed') {
    const job = matchingJob(msg.jobId);
    if (job) terminateJob(job, 'export-error', msg.error || msg.message || 'PDF generation failed.');
  } else if (msg.type === 'export-finished') {
    const job = matchingJob(msg.jobId);
    if (job && job.phase === 'awaiting-finish') {
      clearJobTimer(job);
      activeExportJob = null;
    }
  } else if (!activeExportJob && msg.type === 'clear-list') {
    clearFrameList();
  } else if (!activeExportJob && msg.type === 'remove-frame') {
    listRevision++;
    frameData = frameData.filter(frame => frame.id !== msg.frameId);
    connections = connections.filter(link => link.fromFrameId !== msg.frameId && link.toFrameId !== msg.frameId);
    sendFrameList([]);
  }
};

figma.on('selectionchange', async () => {
  const selectedFrames = figma.currentPage.selection.filter(node => node.type === 'FRAME');
  if (!activeExportJob) await autoAddSelectedFrames(selectedFrames);
  figma.ui.postMessage({
    type: 'selection-changed',
    selectedFrameIds: selectedFrames.map(frame => frame.id),
    selectedFrameNames: selectedFrames.map(frame => frame.name)
  });
});

function describeFrame(frame) {
  const bounds = getFrameExportBounds(frame);
  return {
    id: frame.id,
    name: frame.name,
    width: bounds.width,
    height: bounds.height,
    parent: frame.parent ? frame.parent.name : 'Page'
  };
}

function sendFrameList(justAdded) {
  figma.ui.postMessage({ type: 'frames-updated', frames: frameData, connections, justAdded });
}

async function autoAddSelectedFrames(selectedFrames) {
  if (activeExportJob) return;
  const revision = ++listRevision;
  const justAdded = [];
  for (const frame of selectedFrames) {
    const existing = frameData.findIndex(item => item.id === frame.id);
    if (existing < 0) {
      frameData.push(describeFrame(frame));
      justAdded.push(frame.id);
    } else {
      frameData[existing] = describeFrame(frame);
    }
  }
  // Metadata is available immediately; link scans cannot mutate an active job.
  sendFrameList(justAdded);
  const freshLinks = [];
  const listedIds = new Set(frameData.map(frame => frame.id));
  for (const frame of selectedFrames) {
    await scanNodeForConnections(frame, frame.id, 0, listedIds, freshLinks);
    if (activeExportJob || revision !== listRevision) return;
  }
  const refreshedIds = new Set(selectedFrames.map(frame => frame.id));
  connections = connections.filter(link => !refreshedIds.has(link.fromFrameId)).concat(freshLinks);
  sendFrameList(justAdded);
}

function clearFrameList() {
  listRevision++;
  frameData = [];
  connections = [];
  sendFrameList([]);
}

// Recursively scan nodes for prototype connections AND text hyperlinks.
// Partial text rectangles come from Figma's native PDF annotations. The plugin
// API does not expose character-range geometry; whole-layer bounds are metadata.
const linkKeysBySink = new WeakMap();

async function scanNodeForConnections(node, frameId, depth = 0, exportedFrameIds, sink = connections) {
  if (!node || node.removed || !isLinkNodeVisible(node)) return;
  const roots = exportedFrameIds || new Set(frameData.map(frame => frame.id));
  const bounds = getAbsoluteBounds(node, frameId);

  if (bounds) {
    for (const reaction of node.reactions || []) {
      const actions = Array.isArray(reaction.actions) ? reaction.actions : (reaction.action ? [reaction.action] : []);
      for (const action of actions) {
        if (!action) continue;
        if (action.type === 'URL' && typeof action.url === 'string' && action.url.trim()) {
          appendExtractedLink(sink, {
            fromFrameId: frameId, toUrl: action.url, elementBounds: bounds,
            elementName: node.name || 'Unnamed element', type: 'external', source: 'prototype'
          });
        } else if (action.type === 'NODE' && action.destinationId) {
          const targetId = await resolveExportedLinkTarget(action.destinationId, roots);
          if (targetId) {
            appendExtractedLink(sink, {
              fromFrameId: frameId, toFrameId: targetId, elementBounds: bounds,
              elementName: node.name || 'Unnamed element', type: 'internal', source: 'prototype'
            });
          }
        }
      }
    }

    if (node.type === 'TEXT') {
      let segments = [];
      try {
        if (typeof node.getStyledTextSegments === 'function') {
          segments = node.getStyledTextSegments(['hyperlink']);
        }
      } catch (error) {
        console.warn('Could not read text hyperlinks:', error.message);
      }
      const linkedSegments = segments.filter(segment => segment.hyperlink && segment.hyperlink.value);
      if (linkedSegments.length === 0 && node.hyperlink && node.hyperlink.value) {
        linkedSegments.push({ start: 0, end: (node.characters || '').length,
          characters: node.characters || '', hyperlink: node.hyperlink });
      }

      for (const segment of linkedSegments) {
        const hyperlink = segment.hyperlink;
        const textLength = (node.characters || '').length;
        const start = Number.isInteger(segment.start) ? segment.start : 0;
        const end = Number.isInteger(segment.end) ? segment.end : textLength;
        if (start < 0 || end <= start || end > textLength) continue;
        const needsTextGeometry = start !== 0 || end !== textLength;
        const metadata = {
          fromFrameId: frameId, elementBounds: bounds,
          elementName: node.name || 'Text link', source: 'text',
          textNodeId: node.id, textStart: start, textEnd: end,
          textContent: segment.characters || (node.characters || '').slice(start, end),
          needsTextGeometry
        };
        if (hyperlink.type === 'URL' && typeof hyperlink.value === 'string' && hyperlink.value.trim()) {
          appendExtractedLink(sink, { ...metadata, toUrl: hyperlink.value, type: 'external' });
        } else if (hyperlink.type === 'NODE') {
          const targetId = await resolveExportedLinkTarget(hyperlink.value, roots);
          if (targetId) {
            appendExtractedLink(sink, { ...metadata, toFrameId: targetId,
              toNodeId: hyperlink.value, type: 'internal' });
          }
        }
      }
    }
  }

  // A child can extend outside its parent's own bounds when it is not clipped.
  // Therefore an empty parent intersection alone must not prune this traversal.
  for (const child of node.children || []) {
    await scanNodeForConnections(child, frameId, depth + 1, roots, sink);
  }
}

function appendExtractedLink(sink, link) {
  let state = linkKeysBySink.get(sink);
  if (!state || sink.length < state.length) {
    state = { keys: new Set(), length: sink.length };
    linkKeysBySink.set(sink, state);
  }
  const b = link.elementBounds;
  const key = JSON.stringify([link.fromFrameId, link.type, link.toUrl || link.toFrameId,
    link.source, link.textNodeId, link.textStart, link.textEnd,
    b && b.x, b && b.y, b && b.width, b && b.height]);
  if (state.keys.has(key)) return;
  state.keys.add(key);
  sink.push(link);
  state.length = sink.length;
}

async function resolveExportedLinkTarget(nodeId, exportedFrameIds) {
  if (exportedFrameIds.has(nodeId)) return nodeId;
  let target;
  try { target = await figma.getNodeByIdAsync(nodeId); } catch (_) { return null; }
  while (target) {
    if (exportedFrameIds.has(target.id)) return target.id;
    target = target.parent;
  }
  return null;
}

function isLinkNodeVisible(node) {
  for (let current = node; current; current = current.parent) {
    if (current.removed || current.visible === false || current.opacity === 0) return false;
  }
  return true;
}

function multiplyLinkTransforms(a, b) {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]]
  ];
}

function getLinkTransformToFrame(node, frameId) {
  let transform = [[1, 0, 0], [0, 1, 0]];
  let current = node;
  while (current && current.id !== frameId) {
    const relative = current.relativeTransform || [[1, 0, current.x || 0], [0, 1, current.y || 0]];
    transform = multiplyLinkTransforms(relative, transform);
    current = current.parent;
  }
  if (!current) return null;
  const bounds = getFrameExportBounds(current);
  const worldTransform = multiplyLinkTransforms(getFrameWorldTransform(current), transform);
  return multiplyLinkTransforms([[1, 0, -bounds.x], [0, 1, -bounds.y]], worldTransform);
}

function getFrameWorldTransform(frame) {
  if (Array.isArray(frame.absoluteTransform)) return frame.absoluteTransform;
  let transform = [[1, 0, 0], [0, 1, 0]];
  for (let current = frame; current; current = current.parent) {
    const relative = current.relativeTransform || [[1, 0, current.x || 0], [0, 1, current.y || 0]];
    transform = multiplyLinkTransforms(relative, transform);
  }
  return transform;
}

function getFrameExportBounds(frame) {
  const bounds = frame.absoluteBoundingBox;
  if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  const matrix = getFrameWorldTransform(frame);
  const points = [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]].map(([x, y]) => ({
    x: matrix[0][0] * x + matrix[0][1] * y + matrix[0][2],
    y: matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]
  }));
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function getLinkNodePolygon(node, frameId) {
  const width = Number(node.width);
  const height = Number(node.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const matrix = getLinkTransformToFrame(node, frameId);
  if (!matrix) return [];
  return [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => ({
    x: matrix[0][0] * x + matrix[0][1] * y + matrix[0][2],
    y: matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]
  }));
}

// Intersect convex polygons before converting to the axis-aligned PDF hit area.
// This honors rotated clipping frames instead of moving off-page links inward.
function clipLinkPolygon(subject, clip) {
  if (!subject.length || clip.length < 3) return [];
  const signedArea = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  if (Math.abs(signedArea) < 1e-8) return [];
  const orientation = Math.sign(signedArea);
  let result = subject;
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = p => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = result;
    result = [];
    let previous = input[input.length - 1];
    let previousSide = side(previous);
    for (const point of input) {
      const pointSide = side(point);
      const previousInside = previousSide >= -1e-8;
      const pointInside = pointSide >= -1e-8;
      if (previousInside !== pointInside) {
        const amount = previousSide / (previousSide - pointSide);
        result.push({ x: previous.x + amount * (point.x - previous.x),
          y: previous.y + amount * (point.y - previous.y) });
      }
      if (pointInside) result.push(point);
      previous = point;
      previousSide = pointSide;
    }
  }
  return result;
}

// Figma exports the source frame's axis-aligned world bounding box, including
// its rotation. Express every hit area relative to that same export origin.
function getAbsoluteBounds(node, frameId) {
  let polygon = getLinkNodePolygon(node, frameId);
  if (!polygon.length) return null;
  let current = node;
  while (current) {
    if (current.id === frameId || (current !== node && current.clipsContent)) {
      polygon = clipLinkPolygon(polygon, getLinkNodePolygon(current, frameId));
      if (!polygon.length) return null;
    }
    if (current.id === frameId) break;
    current = current.parent;
  }
  if (!current) return null;
  const xs = polygon.map(point => point.x), ys = polygon.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  return [x, y, width, height].every(Number.isFinite) && width > 1e-8 && height > 1e-8
    ? { x, y, width, height } : null;
}

function getTextRangeBounds(node, frameId, start, end) {
  // Only whole-node links have safe fallback geometry. Partial text ranges must
  // use the exact annotations in the native PDF, never an overlapping rectangle.
  if (start !== 0 || end !== (node.characters || '').length) return [];
  const bounds = getAbsoluteBounds(node, frameId);
  return bounds ? [bounds] : [];
}

// ============================================================================
// Sequential export protocol
// ============================================================================

function matchingJob(jobId) {
  return activeExportJob && activeExportJob.id === jobId ? activeExportJob : null;
}

function jobIsRunning(job) {
  return !!job && activeExportJob === job && !job.terminal;
}

function clearJobTimer(job) {
  if (job.timer !== null) clearTimeout(job.timer);
  job.timer = null;
}

function removeSourceWatchers(job) {
  if (job.styleWatcher && typeof figma.off === 'function') figma.off('stylechange', job.styleWatcher);
  job.styleWatcher = null;
  for (const page of job.watchedPages) {
    if (typeof page.off === 'function') page.off('nodechange', job.nodeWatcher);
  }
  job.watchedPages.clear();
}

function watchSourcePage(job, node) {
  let page = node;
  while (page && page.type !== 'PAGE') page = page.parent;
  if (!page || job.watchedPages.has(page) || typeof page.on !== 'function') return;
  page.on('nodechange', job.nodeWatcher);
  job.watchedPages.add(page);
}

function finalizeTerminalJob(job) {
  if (!job.terminal || job.operations > 0 || activeExportJob !== job) return;
  clearJobTimer(job);
  removeSourceWatchers(job);
  job.pending = null;
  activeExportJob = null;
  figma.ui.postMessage({ type: job.terminal.type, jobId: job.id, error: job.terminal.error });
}

function terminateJob(job, type, error) {
  if (activeExportJob !== job || job.terminal) return;
  clearJobTimer(job);
  job.pending = null;
  job.terminal = { type, error: error ? String(error) : undefined };
  // Native Figma export cannot be interrupted. Keep the job reserved until the
  // current await settles, then acknowledge cancellation and allow a new job.
  finalizeTerminalJob(job);
}

async function runJobOperation(job, operation) {
  if (!jobIsRunning(job)) return;
  job.operations++;
  try {
    await operation();
  } catch (error) {
    if (jobIsRunning(job)) terminateJob(job, 'export-error', error.message || String(error));
  } finally {
    job.operations--;
    finalizeTerminalJob(job);
  }
}

function failNewJob(jobId, error) {
  figma.ui.postMessage({ type: 'export-error', jobId, error });
}

function orderedSelectedIds(frameOrder, selectedFrames) {
  if (!Array.isArray(frameOrder) || !Array.isArray(selectedFrames)) {
    throw new Error('Choose frames before exporting.');
  }
  if (selectedFrames.some(id => typeof id !== 'string' || !id)) {
    throw new Error('The selected frame list is invalid. Add the frames again.');
  }
  const selected = new Set(selectedFrames);
  const seen = new Set();
  const ordered = [];
  for (const id of frameOrder) {
    if (selected.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  if (ordered.length === 0) throw new Error('Select at least one frame to export.');
  if (ordered.length !== selected.size) {
    throw new Error('Some selected frames are missing from the page order. Add them again.');
  }
  return ordered;
}

function validateFrameSize(frame) {
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new Error(`“${frame.name}” has invalid dimensions. Give the frame a positive width and height.`);
  }
}

function validateRasterSize(frame, scale, outputColorMode = 'RGB') {
  const maxPixels = outputColorMode === 'CMYK' ? EXPORT_LIMITS.maxCmykRasterPixels : EXPORT_LIMITS.maxRasterPixels;
  const width = Math.ceil(frame.width * scale);
  const height = Math.ceil(frame.height * scale);
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width < 1 || height < 1 ||
      width > EXPORT_LIMITS.maxRasterSide || height > EXPORT_LIMITS.maxRasterSide ||
      width * height > maxPixels) {
    const limit = outputColorMode === 'CMYK' ? 'CMYK beta is limited to 8 million pixels' : 'Raster export is limited to 32 million pixels';
    throw new Error(`“${frame.name}” would render at ${width}×${height} pixels. ${limit} and 16,384 pixels per side. Lower the quality, enable Fit oversized pages, or reduce this frame’s size.`);
  }
  return { scale, width, height };
}

function rasterPlan(frame, requestedScale, fitOversized, outputColorMode = 'RGB') {
  const maxPixels = outputColorMode === 'CMYK' ? EXPORT_LIMITS.maxCmykRasterPixels : EXPORT_LIMITS.maxRasterPixels;
  const fits = scale => {
    const width = Math.ceil(frame.width * scale), height = Math.ceil(frame.height * scale);
    return width >= 1 && height >= 1 && width <= EXPORT_LIMITS.maxRasterSide &&
      height <= EXPORT_LIMITS.maxRasterSide && width * height <= maxPixels;
  };
  if (!fitOversized || fits(requestedScale)) return validateRasterSize(frame, requestedScale, outputColorMode);
  // The continuous limit can round up to too many pixels. Search below it using
  // the same integer dimensions as the guard, including extreme aspect ratios.
  let high = Math.min(requestedScale, EXPORT_LIMITS.maxRasterSide / frame.width,
    EXPORT_LIMITS.maxRasterSide / frame.height,
    Math.sqrt(maxPixels) / Math.sqrt(frame.width) / Math.sqrt(frame.height));
  if (fits(high)) return validateRasterSize(frame, high, outputColorMode);
  let low = 0;
  for (let i = 0; i < 64; i++) {
    const middle = low + (high - low) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return validateRasterSize(frame, low, outputColorMode);
}

function unsupportedPdfBlendMode(frame) {
  const unsupported = new Set(['LINEAR_BURN', 'LINEAR_DODGE', 'PLUS_DARKER', 'PLUS_LIGHTER']);
  const stack = [frame];
  while (stack.length) {
    const node = stack.pop();
    if (!node || node.visible === false || node.opacity === 0) continue;
    if (unsupported.has(node.blendMode)) return node.blendMode;
    for (const property of ['fills', 'strokes', 'effects']) {
      if (!Array.isArray(node[property])) continue;
      for (const entry of node[property]) {
        if (entry && entry.visible !== false && entry.opacity !== 0 && unsupported.has(entry.blendMode)) {
          return entry.blendMode;
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) stack.push(child);
    }
  }
  return null;
}

function readDocumentColorProfile() {
  const profile = figma.root && figma.root.documentColorProfile;
  if (profile !== 'LEGACY' && profile !== 'SRGB' && profile !== 'DISPLAY_P3') {
    throw new Error('The document color profile is unavailable or unsupported. Reopen the file in an updated Figma version before exporting.');
  }
  return profile;
}

function resolveExportColorProfile(requested, sourceProfile) {
  if (requested === 'CMYK') return 'SRGB';
  if (requested === 'SRGB' || requested === 'DISPLAY_P3_V4') return requested;
  if (requested !== 'DOCUMENT') throw new Error('Choose sRGB, Display P3, the document color profile, or CMYK.');
  if (sourceProfile === 'SRGB') return 'SRGB';
  if (sourceProfile === 'DISPLAY_P3') return 'DISPLAY_P3_V4';
  // LEGACY can follow a preference that the API does not expose. Keep Figma's
  // DOCUMENT behavior and preserve actual exported metadata, without guessing
  // or promising that this otherwise invisible preference is frozen per job.
  return 'DOCUMENT';
}

function verifySourceColorProfile(job) {
  if (!jobIsRunning(job)) return false;
  try {
    if (readDocumentColorProfile() !== job.sourceColorProfile) {
      throw new Error('The document color profile changed during export. Start a new export so every page uses the same source colors.');
    }
    return true;
  } catch (error) {
    // Terminal state rather than a thrown error prevents native-PDF fallback
    // and auxiliary-annotation catches from swallowing a changed profile.
    terminateJob(job, 'export-error', error.message || String(error));
    return false;
  }
}

async function startExport(msg) {
  if (typeof msg.jobId !== 'string' || !msg.jobId) {
    failNewJob(msg.jobId, 'The export request is missing its job ID. Please try again.');
    return;
  }
  if (activeExportJob) {
    // A repeated start for the same job must not terminate the live UI job.
    if (activeExportJob.id !== msg.jobId) failNewJob(msg.jobId, 'Another export is still running. Cancel it or wait for it to finish.');
    return;
  }
  if (usedJobIds.has(msg.jobId)) {
    failNewJob(msg.jobId, 'This export request has already finished. Start a new export.');
    return;
  }
  const job = {
    id: msg.jobId,
    phase: 'preflight',
    operations: 0,
    terminal: null,
    timer: null,
    pending: null,
    frames: [],
    connections: [],
    nextIndex: 0,
    watchedPages: new Set(),
    nodeWatcher: null,
    styleWatcher: null,
    transferredBytes: 0,
    scale: msg.qualityScale === undefined ? 1.5 : msg.qualityScale,
    exportType: msg.exportType || 'raster',
    rasterFormat: msg.rasterFormat === undefined ? 'PNG' : msg.rasterFormat,
    fitOversized: msg.fitOversized === undefined ? false : msg.fitOversized,
    requestedColorProfile: msg.colorProfile === undefined ? 'DOCUMENT' : msg.colorProfile,
    sourceColorProfile: null,
    exportColorProfile: null,
    outputColorMode: msg.colorProfile === 'CMYK' ? 'CMYK' : 'RGB'
  };
  activeExportJob = job;
  usedJobIds.add(job.id);
  listRevision++;

  await runJobOperation(job, async () => {
    job.sourceColorProfile = readDocumentColorProfile();
    job.exportColorProfile = resolveExportColorProfile(job.requestedColorProfile, job.sourceColorProfile);
    const sourceChanged = () => {
      if (jobIsRunning(job) && job.phase !== 'awaiting-finish') {
        if (!verifySourceColorProfile(job)) return;
        terminateJob(job, 'export-error', 'The design changed during export. Wait until editing is finished, then export again so all pages and links match.');
      }
    };
    job.nodeWatcher = sourceChanged;
    job.styleWatcher = sourceChanged;
    figma.on('stylechange', sourceChanged);
    // Page-level events work with dynamic-page access; documentchange would
    // require loading the entire document, which is costly for large files.
    watchSourcePage(job, figma.currentPage);
    if (!Number.isFinite(job.scale) || job.scale <= 0) throw new Error('Export quality must be a positive number.');
    if (job.exportType !== 'vector' && job.exportType !== 'raster') throw new Error('Choose Vector or Rasterized export.');
    if (job.rasterFormat !== 'PNG' && job.rasterFormat !== 'JPG') throw new Error('Choose PNG or JPG for raster pages.');
    if (typeof job.fitOversized !== 'boolean') throw new Error('Fit oversized pages must be enabled or disabled.');
    if (job.outputColorMode === 'CMYK') {
      // The UI converts explicit sRGB samples with the chosen printer profile.
      // PNG avoids a lossy intermediate before that conversion.
      job.exportType = 'raster';
      job.rasterFormat = 'PNG';
    }
    const ids = orderedSelectedIds(msg.frameOrder, msg.selectedFrames);
    const selectedIds = new Set(ids);
    const liveFrames = [];
    for (const id of ids) {
      const frame = await figma.getNodeByIdAsync(id);
      if (!verifySourceColorProfile(job)) return;
      if (!frame || frame.type !== 'FRAME') throw new Error('A selected frame was removed or is no longer available. Refresh the list and try again.');
      watchSourcePage(job, frame);
      validateFrameSize(frame);
      const metadata = describeFrame(frame);
      validateFrameSize(metadata);
      if (job.exportType === 'raster' || unsupportedPdfBlendMode(frame)) rasterPlan(metadata, job.scale, job.fitOversized, job.outputColorMode);
      job.frames.push(metadata);
      liveFrames.push(frame);
    }
    for (const frame of liveFrames) {
      await scanNodeForConnections(frame, frame.id, 0, selectedIds, job.connections);
      if (!verifySourceColorProfile(job)) return;
    }
    job.connections = job.connections.filter(link =>
      selectedIds.has(link.fromFrameId) && (link.type === 'external' || selectedIds.has(link.toFrameId))
    );
    // Refresh list metadata too, without changing the user's export order.
    const freshById = new Map(job.frames.map(frame => [frame.id, frame]));
    frameData = frameData.map(frame => freshById.get(frame.id) || frame);
    connections = connections.filter(link => !selectedIds.has(link.fromFrameId)).concat(job.connections);
    figma.ui.postMessage({ type: 'export-start', jobId: job.id, frames: job.frames, connections: job.connections, exportColorProfile: job.exportColorProfile, outputColorMode: job.outputColorMode, warnings: [] });
    if (!jobIsRunning(job)) return;
    await exportPage(job, 0);
  });
}

function assertUnchangedDimensions(frame, metadata) {
  const bounds = frame.removed ? null : getFrameExportBounds(frame);
  if (!bounds || bounds.width !== metadata.width || bounds.height !== metadata.height) {
    throw new Error(`“${metadata.name}” changed size during export. Start the export again to use its current dimensions.`);
  }
}

function checkedExportBytes(data, name) {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) {
    throw new Error(`Figma returned no usable export data for “${name}”.`);
  }
  return data;
}

function colorProfileProbeScale(frame) {
  // This image is only a color-metadata carrier, never a PDF page image.
  let scale = Math.min(1, 64 / Math.max(frame.width, frame.height));
  if (Math.ceil(frame.width * scale) > 64 || Math.ceil(frame.height * scale) > 64) {
    scale *= 1 - Number.EPSILON;
  }
  if (!Number.isFinite(scale) || scale <= 0 || Math.ceil(frame.width * scale) > 64 || Math.ceil(frame.height * scale) > 64) {
    throw new Error(`Could not obtain a bounded color-profile sample for “${frame.name}”. Choose sRGB or Display P3 explicitly.`);
  }
  return scale;
}

function checkedColorProfileProbe(data, name) {
  checkedExportBytes(data, name);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  const read32 = offset => data[offset] * 16777216 + data[offset + 1] * 65536 + data[offset + 2] * 256 + data[offset + 3];
  if (data.byteLength < 33 || signature.some((byte, index) => data[index] !== byte) ||
      read32(16) < 1 || read32(16) > 64 || read32(20) < 1 || read32(20) > 64) {
    throw new Error(`Figma returned an invalid color-profile sample for “${name}”. Choose sRGB or Display P3 explicitly.`);
  }
  // The assembler validates CRCs, ICC data and sRGB metadata before using it.
  return data;
}

async function exportPage(job, index, options = {}) {
  if (!verifySourceColorProfile(job)) return;
  job.phase = 'exporting';
  const metadata = job.frames[index];
  const frame = await figma.getNodeByIdAsync(metadata.id);
  if (!verifySourceColorProfile(job)) return;
  if (!frame || frame.type !== 'FRAME') throw new Error(`“${metadata.name}” is no longer available. Start the export again.`);
  assertUnchangedDimensions(frame, metadata);
  const warnings = [];
  const unsupportedMode = unsupportedPdfBlendMode(frame);
  let format = job.exportType === 'raster' || options.forceRaster || unsupportedMode ? job.rasterFormat : 'PDF';
  let data;
  let annotationPdfData = options.annotationPdfData;
  let colorProfilePngData;
  let nativeExportFailed = false;
  if (unsupportedMode && job.exportType === 'vector') {
    warnings.push(`“${metadata.name}” uses ${unsupportedMode === 'PLUS_DARKER' || unsupportedMode === 'LINEAR_BURN' ? 'Plus darker' : 'Plus lighter'}, which Figma does not support in PDF. This page is rasterized.`);
  }
  if (options.forceRaster) warnings.push(`“${metadata.name}” was rasterized because its native PDF could not be merged.`);
  if (format === 'PDF') {
    try {
      data = await frame.exportAsync({ format: 'PDF', useAbsoluteBounds: true, colorProfile: job.exportColorProfile });
      if (!verifySourceColorProfile(job)) return;
      data = checkedExportBytes(data, metadata.name);
    } catch (error) {
      if (!verifySourceColorProfile(job)) return;
      nativeExportFailed = true;
      format = job.rasterFormat;
      warnings.push(`“${metadata.name}” was rasterized because Figma could not export its PDF: ${error.message || error}`);
    }
  }
  if (format === 'PNG' || format === 'JPG') {
    const plan = rasterPlan(metadata, job.scale, job.fitOversized, job.outputColorMode);
    if (plan.scale < job.scale) {
      const limit = job.outputColorMode === 'CMYK' ? ' CMYK beta is limited to 8 million pixels and 16,384 pixels per side.' : '';
      warnings.push(`“${metadata.name}” was fitted to ${plan.width}×${plan.height} pixels: requested ${Number(job.scale.toPrecision(4))}×, actual ${Number(plan.scale.toPrecision(4))}×. Its PDF page dimensions are unchanged.${limit}`);
    }
    const settings = { format, useAbsoluteBounds: true, colorProfile: job.exportColorProfile, constraint: { type: 'SCALE', value: plan.scale } };
    data = await frame.exportAsync(settings);
    if (!verifySourceColorProfile(job)) return;
    data = checkedExportBytes(data, metadata.name);
    if (format === 'JPG' && job.exportColorProfile === 'DOCUMENT') {
      // Figma's legacy JPEG export may omit ICC metadata. A tiny PNG exported
      // with the same DOCUMENT setting lets the UI identify actual colors.
      try {
        colorProfilePngData = await frame.exportAsync({ format: 'PNG', useAbsoluteBounds: true,
          colorProfile: 'DOCUMENT', constraint: { type: 'SCALE', value: colorProfileProbeScale(metadata) } });
        if (!verifySourceColorProfile(job)) return;
        colorProfilePngData = checkedColorProfileProbe(colorProfilePngData, metadata.name);
      } catch (error) {
        if (!verifySourceColorProfile(job)) return;
        throw new Error(`Could not verify the JPEG color profile for “${metadata.name}”: ${error.message || error}. Choose sRGB or Display P3 explicitly.`);
      }
    }
    const hasTextLinks = job.connections.some(link => link.fromFrameId === metadata.id && link.source === 'text');
    if (!hasTextLinks) annotationPdfData = undefined;
    if (hasTextLinks && !annotationPdfData && !nativeExportFailed) {
      try {
        annotationPdfData = await frame.exportAsync({ format: 'PDF', useAbsoluteBounds: true, colorProfile: job.exportColorProfile });
        if (!verifySourceColorProfile(job)) return;
        annotationPdfData = checkedExportBytes(annotationPdfData, metadata.name);
      } catch (error) {
        if (!verifySourceColorProfile(job)) return;
        annotationPdfData = undefined;
        warnings.push(`Precise text links could not be recovered for “${metadata.name}”: ${error.message || error}`);
      }
    } else if (hasTextLinks && nativeExportFailed) {
      warnings.push(`Precise text links could not be recovered for “${metadata.name}” because its native PDF export failed.`);
    }
  }
  if (!verifySourceColorProfile(job)) return;
  assertUnchangedDimensions(frame, metadata);
  const transferBytes = data.byteLength + (annotationPdfData ? annotationPdfData.byteLength : 0) + (colorProfilePngData ? colorProfilePngData.byteLength : 0);
  if (transferBytes > EXPORT_LIMITS.maxPageTransferBytes) {
    throw new Error(`“${metadata.name}” exceeds the provisional 128 MiB per-page transfer limit, including its text-link and color-profile data. Reduce raster quality or simplify this frame.`);
  }
  job.transferredBytes += transferBytes;
  const pending = { index, format, nativePdfData: format === 'PDF' ? data : null };
  job.pending = pending;
  job.phase = 'awaiting-ack';
  job.timer = setTimeout(() => {
    if (jobIsRunning(job) && job.pending === pending) {
      terminateJob(job, 'export-error', `PDF processing did not acknowledge page ${index + 1} within two minutes. Start a new export.`);
    }
  }, EXPORT_LIMITS.acknowledgementTimeoutMs);
  const message = { type: 'export-page', jobId: job.id, index, frame: metadata, format, data, exportColorProfile: job.exportColorProfile, outputColorMode: job.outputColorMode, warnings };
  if (annotationPdfData) message.annotationPdfData = annotationPdfData;
  if (colorProfilePngData) message.colorProfilePngData = colorProfilePngData;
  figma.ui.postMessage(message);
}

function pauseForSavedPart(msg) {
  const job = matchingJob(msg.jobId);
  if (!jobIsRunning(job) || job.phase !== 'awaiting-ack' || !job.pending || job.pending.index !== msg.index) return;
  if (!verifySourceColorProfile(job)) return;
  clearJobTimer(job);
  job.pending.nativePdfData = null;
  job.phase = 'awaiting-part';
  // The page has been accepted into a completed part. Keep its document snapshot
  // guarded while the user saves/continues, without an unbounded reserved job.
  job.timer = setTimeout(() => {
    if (jobIsRunning(job) && job.phase === 'awaiting-part') {
      terminateJob(job, 'export-error', 'Continuing the next PDF part did not start within 15 minutes. Start a new export to continue.');
    }
  }, EXPORT_LIMITS.partContinuationTimeoutMs);
}

async function acknowledgePage(msg) {
  const job = matchingJob(msg.jobId);
  if (!jobIsRunning(job) || !job.pending || job.pending.index !== msg.index ||
      (job.phase !== 'awaiting-ack' && job.phase !== 'awaiting-part')) return;
  const pending = job.pending;
  // A saved part cannot be rewritten, and raster replacements cannot retry.
  if (msg.fallback === true && (job.phase === 'awaiting-part' || pending.format !== 'PDF')) return;
  if (!verifySourceColorProfile(job)) return;
  const annotationPdfData = msg.fallback === true &&
    job.connections.some(link => link.fromFrameId === job.frames[msg.index].id && link.source === 'text')
    ? pending.nativePdfData : undefined;
  pending.nativePdfData = null;
  clearJobTimer(job);
  job.pending = null;
  await runJobOperation(job, async () => {
    if (msg.fallback === true) {
      await exportPage(job, msg.index, { forceRaster: true, annotationPdfData });
      return;
    }
    job.nextIndex = msg.index + 1;
    if (job.nextIndex < job.frames.length) {
      await exportPage(job, job.nextIndex);
    } else {
      job.phase = 'awaiting-finish';
      removeSourceWatchers(job);
      job.timer = setTimeout(() => {
        if (jobIsRunning(job) && job.phase === 'awaiting-finish') {
          terminateJob(job, 'export-error', 'Saving the PDF did not finish within two minutes. Start a new export.');
        }
      }, EXPORT_LIMITS.finishTimeoutMs);
      figma.ui.postMessage({ type: 'export-complete', jobId: job.id });
    }
  });
}

figma.ui.postMessage({ type: 'plugin-ready', message: 'Select frames in Figma to add them to the export list' });
const initiallySelectedFrames = figma.currentPage.selection.filter(node => node.type === 'FRAME');
if (initiallySelectedFrames.length) {
  autoAddSelectedFrames(initiallySelectedFrames).catch(error => console.warn('Could not refresh the initial selection:', error));
}
