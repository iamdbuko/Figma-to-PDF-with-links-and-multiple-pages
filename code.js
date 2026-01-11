// Main plugin code that runs in Figma's sandbox
// Enhanced with Hybrid Vector/Raster Export following Figma's Engineering Approach

// Show UI
figma.showUI(__html__, { width: 400, height: 600 });

// Store frame data and connections - only for selected frames
let frameData = [];
let connections = [];

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'clear-list') {
    clearFrameList();
  } else if (msg.type === 'export-pdf') {
    await exportToPDF(msg.frameOrder, msg.selectedFrames, msg.qualityScale || 1.5, msg.quality || 'high', msg.exportType || 'raster');
  } else if (msg.type === 'export-batch') {
    // Export a specific batch
    const batch = msg.batch;
    const batchFrames = frameData.filter(frame => batch.frameIds.includes(frame.id));
    const orderedBatchFrames = batch.frameIds.map(id => batchFrames.find(f => f.id === id)).filter(Boolean);

    await performExport(
      orderedBatchFrames,
      batch.frameIds,
      batch.frameIds,
      msg.qualityScale,
      msg.quality,
      {
        current: msg.batchNumber,
        total: msg.totalBatches
      },
      msg.exportType || 'raster'
    );
  } else if (msg.type === 'request-png-fallback') {
    // UI requested PNG fallback for a specific frame that failed validation
    await handlePngFallbackRequest(msg.frameId, msg.frameIndex, msg.qualityScale || 1.5);
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// Listen for selection changes
figma.on('selectionchange', async () => {
  console.log('Selection changed in Figma');
  const selectedNodes = figma.currentPage.selection;
  const selectedFrames = selectedNodes.filter(node => node.type === 'FRAME');

  console.log('Found ' + selectedFrames.length + ' selected frames:', selectedFrames.map(f => f.name));

  // Auto-add selected frames to the list
  if (selectedFrames.length > 0) {
    await autoAddSelectedFrames(selectedFrames);
  }

  // Always send selection update
  figma.ui.postMessage({
    type: 'selection-changed',
    selectedFrameIds: selectedFrames.map(frame => frame.id),
    selectedFrameNames: selectedFrames.map(frame => frame.name)
  });
});

// Auto-add selected frames to the list (called on selection change)
async function autoAddSelectedFrames(selectedFrames) {
  console.log('autoAddSelectedFrames called with:', selectedFrames.length, 'frames');
  let newFramesAdded = [];

  // Add new frames to the list (avoid duplicates)
  for (const frame of selectedFrames) {
    const existingFrame = frameData.find(f => f.id === frame.id);
    console.log('Checking frame "' + frame.name + '" (' + frame.id + '):', existingFrame ? 'already exists' : 'new frame');

    if (!existingFrame) {
      const newFrame = {
        id: frame.id,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        parent: frame.parent ? frame.parent.name : 'Page'
      };

      frameData.push(newFrame);
      console.log('Added frame to frameData:', newFrame);

      // Scan for prototype connections in this new frame
      await scanNodeForConnections(frame, frame.id, 0);
      newFramesAdded.push(frame.id);
    }
  }

  // Always send update to UI
  console.log('Sending frames-updated message. Total frames: ' + frameData.length + ', New frames: ' + newFramesAdded.length);

  figma.ui.postMessage({
    type: 'frames-updated',
    frames: frameData,
    connections: connections,
    justAdded: newFramesAdded
  });
}

// Clear the frame list
function clearFrameList() {
  frameData = [];
  connections = [];

  figma.ui.postMessage({
    type: 'frames-updated',
    frames: [],
    connections: [],
    justAdded: []
  });
}

// Recursively scan nodes for prototype connections AND text hyperlinks
async function scanNodeForConnections(node, frameId, depth) {
  const indent = '  '.repeat(depth);
  console.log(indent + 'Scanning node: ' + node.type + ' "' + node.name + '" (depth ' + depth + ')');

  // Check if this node has reactions (prototype connections)
  if (node.reactions && node.reactions.length > 0) {
    console.log(indent + 'Found ' + node.reactions.length + ' reactions on ' + node.type + ' "' + node.name + '"');
    for (const reaction of node.reactions) {
      if (reaction.action) {
        if (reaction.action.type === 'NODE' && reaction.action.destinationId) {
          // Internal frame link
          const destinationNode = await figma.getNodeByIdAsync(reaction.action.destinationId);
          if (destinationNode && destinationNode.type === 'FRAME') {
            const bounds = getAbsoluteBounds(node, frameId);
            console.log(indent + '✅ Found internal prototype link: ' + node.name + ' -> ' + destinationNode.name);

            connections.push({
              fromFrameId: frameId,
              toFrameId: reaction.action.destinationId,
              elementBounds: bounds,
              elementName: node.name || 'Unnamed element',
              type: 'internal'
            });
          }
        } else if (reaction.action.type === 'URL' && reaction.action.url) {
          // External URL link from prototype
          const bounds = getAbsoluteBounds(node, frameId);
          console.log(indent + '✅ Found external prototype link: ' + node.name + ' -> ' + reaction.action.url);

          connections.push({
            fromFrameId: frameId,
            toUrl: reaction.action.url,
            elementBounds: bounds,
            elementName: node.name || 'Unnamed element',
            type: 'external'
          });
        }
      }
    }
  }

  // Check if this is a TEXT node with hyperlinks
  if (node.type === 'TEXT') {
    const textPreview = node.characters ? node.characters.substring(0, 50) : 'no characters';
    console.log(indent + 'Found TEXT node: "' + node.name + '" with characters: "' + textPreview + '"');

    let hasSegmentHyperlinks = false;

    // Check for character-level hyperlinks (rich text)
    try {
      if (node.getStyledTextSegments) {
        const segments = node.getStyledTextSegments(['hyperlink']);
        console.log(indent + 'Found ' + segments.length + ' styled text segments');

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          console.log(indent + 'Segment ' + i + ' has hyperlink: ' + (segment.hyperlink ? 'yes' : 'no'));

          if (segment.hyperlink && segment.hyperlink.value) {
            hasSegmentHyperlinks = true;
            const segmentLabel = segment.characters ? segment.characters.substring(0, 30) : 'unknown';
            const boundsList = getTextRangeBounds(node, frameId, segment.start, segment.end);

            if (segment.hyperlink.type === 'URL') {
              console.log(indent + '✅ Found styled text hyperlink: "' + segmentLabel + '" -> ' + segment.hyperlink.value);
              for (const bounds of boundsList) {
                connections.push({
                  fromFrameId: frameId,
                  toUrl: segment.hyperlink.value,
                  elementBounds: bounds,
                  elementName: node.name || ('Text Link: "' + (segment.characters ? segment.characters.substring(0, 20) : 'unknown') + '"'),
                  type: 'external'
                });
              }
            } else if (segment.hyperlink.type === 'NODE') {
              const destinationNode = await figma.getNodeByIdAsync(segment.hyperlink.value);
              if (destinationNode && destinationNode.type === 'FRAME') {
                console.log(indent + '✅ Found styled text link to frame: "' + segmentLabel + '" -> ' + destinationNode.name);
                for (const bounds of boundsList) {
                  connections.push({
                    fromFrameId: frameId,
                    toFrameId: segment.hyperlink.value,
                    elementBounds: bounds,
                    elementName: node.name || ('Text Link: "' + (segment.characters ? segment.characters.substring(0, 20) : 'unknown') + '"'),
                    type: 'internal'
                  });
                }
              }
            }
          }
        }
      } else {
        console.log(indent + 'getStyledTextSegments not available');
      }
    } catch (error) {
      console.log(indent + 'Error checking styled text segments: ' + error.message);
    }

    // Check for simple hyperlink property (only when no segment hyperlinks)
    if (!hasSegmentHyperlinks) {
      if (node.hyperlink) {
        console.log(indent + 'TEXT node has hyperlink property:', {
          type: node.hyperlink.type,
          value: node.hyperlink.value
        });

        const bounds = getAbsoluteBounds(node, frameId);

        if (node.hyperlink.type === 'URL' && node.hyperlink.value) {
          const textSample = node.characters ? node.characters.substring(0, 30) : 'unknown';
          console.log(indent + '✅ Found text hyperlink: "' + textSample + '" -> ' + node.hyperlink.value);
          connections.push({
            fromFrameId: frameId,
            toUrl: node.hyperlink.value,
            elementBounds: bounds,
            elementName: node.name || ('Text: "' + (node.characters ? node.characters.substring(0, 20) : 'unknown') + ((node.characters && node.characters.length > 20) ? '...' : '') + '"'),
            type: 'external'
          });
        } else if (node.hyperlink.type === 'NODE' && node.hyperlink.value) {
          // Text hyperlink to another frame
          const destinationNode = await figma.getNodeByIdAsync(node.hyperlink.value);
          if (destinationNode && destinationNode.type === 'FRAME') {
            const textSample = node.characters ? node.characters.substring(0, 30) : 'unknown';
            console.log(indent + '✅ Found text link to frame: "' + textSample + '" -> ' + destinationNode.name);
            connections.push({
              fromFrameId: frameId,
              toFrameId: node.hyperlink.value,
              elementBounds: bounds,
              elementName: node.name || ('Text: "' + (node.characters ? node.characters.substring(0, 20) : 'unknown') + ((node.characters && node.characters.length > 20) ? '...' : '') + '"'),
              type: 'internal'
            });
          }
        }
      } else {
        console.log(indent + 'TEXT node has no hyperlink property');
      }
    }
  }

  // Recursively check children
  if ('children' in node && node.children.length > 0) {
    console.log(indent + 'Checking ' + node.children.length + ' children of ' + node.type + ' "' + node.name + '"');
    for (const child of node.children) {
      await scanNodeForConnections(child, frameId, depth + 1);
    }
  }
}

// Get absolute bounds of an element relative to its frame
function getAbsoluteBounds(node, frameId) {
  let x = 0;
  let y = 0;
  let current = node;

  // Walk up the tree until we reach the frame
  while (current && current.id !== frameId) {
    x += current.x || 0;
    y += current.y || 0;
    current = current.parent;
  }

  return {
    x: x,
    y: y,
    width: node.width || 0,
    height: node.height || 0
  };
}

function getNodeOffsetToFrame(node, frameId) {
  let x = 0;
  let y = 0;
  let current = node;

  while (current && current.id !== frameId) {
    x += current.x || 0;
    y += current.y || 0;
    current = current.parent;
  }

  return { x, y };
}

function getTextRangeBounds(node, frameId, start, end) {
  const fallback = [getAbsoluteBounds(node, frameId)];
  const offset = getNodeOffsetToFrame(node, frameId);

  try {
    if (typeof node.getRangeBounds === 'function') {
      const rangeBounds = node.getRangeBounds(start, end);
      if (Array.isArray(rangeBounds)) {
        const rects = rangeBounds
          .filter(rect => rect && rect.width > 0 && rect.height > 0)
          .map(rect => ({
            x: offset.x + rect.x,
            y: offset.y + rect.y,
            width: rect.width,
            height: rect.height
          }));
        return rects.length > 0 ? rects : fallback;
      }
      if (rangeBounds && rangeBounds.width > 0 && rangeBounds.height > 0) {
        return [{
          x: offset.x + rangeBounds.x,
          y: offset.y + rangeBounds.y,
          width: rangeBounds.width,
          height: rangeBounds.height
        }];
      }
    }
  } catch (error) {
    console.log('Error getting text range bounds: ' + error.message);
  }

  return fallback;
}

// ============================================================================
// HYBRID VECTOR/RASTER DETECTION - Following Figma's Engineering Approach
// ============================================================================

// Effects that MUST be rasterized (cannot be represented as vectors in PDF)
const MUST_RASTERIZE_EFFECTS = [
  'LAYER_BLUR',
  'BACKGROUND_BLUR'
];

// Effects that SHOULD be rasterized for best quality
const SHOULD_RASTERIZE_EFFECTS = [
  'DROP_SHADOW',
  'INNER_SHADOW'
];

// Blend modes that may cause issues in PDF
const PROBLEMATIC_BLEND_MODES = [
  'MULTIPLY',
  'SCREEN',
  'OVERLAY',
  'DARKEN',
  'LIGHTEN',
  'COLOR_DODGE',
  'COLOR_BURN',
  'HARD_LIGHT',
  'SOFT_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
  'PLUS_DARKER',
  'PLUS_LIGHTER'
];

const RASTERIZE_EFFECTS = MUST_RASTERIZE_EFFECTS.concat(SHOULD_RASTERIZE_EFFECTS);

function hasVisiblePaints(paints) {
  if (!Array.isArray(paints)) return false;
  return paints.some((paint) => paint && paint.visible !== false);
}

function nodeHasRenderableSelf(node) {
  if (node.type === 'TEXT') return true;
  if ('fills' in node && hasVisiblePaints(node.fills)) return true;
  if ('strokes' in node && hasVisiblePaints(node.strokes)) return true;
  return false;
}

function nodeNeedsRaster(node) {
  if (node.effects && node.effects.length > 0) {
    for (const effect of node.effects) {
      if (effect.visible !== false && RASTERIZE_EFFECTS.includes(effect.type)) {
        return true;
      }
    }
  }

  if (node.blendMode && PROBLEMATIC_BLEND_MODES.includes(node.blendMode)) {
    return true;
  }

  if (node.isMask && node.effects && node.effects.length > 0) {
    return true;
  }

  return false;
}

function collectAllNodes(root) {
  const nodes = [];
  if (!root) return nodes;

  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);

    if ('children' in node && node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  return nodes;
}

function collectSubtreeNodes(node) {
  const nodes = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes.push(current);
    if ('children' in current && current.children) {
      for (let i = current.children.length - 1; i >= 0; i--) {
        stack.push(current.children[i]);
      }
    }
  }
  return nodes;
}

function getAncestorChain(node, stopNode) {
  const ancestors = [];
  let current = node.parent;
  while (current && current !== stopNode) {
    ancestors.push(current);
    current = current.parent;
  }
  if (stopNode) {
    ancestors.push(stopNode);
  }
  return ancestors;
}

function buildFrameSegments(frame) {
  const segments = [];
  let currentVectorNodes = [];

  function flushVector() {
    if (currentVectorNodes.length === 0) return;
    const uniqueNodes = Array.from(new Set(currentVectorNodes));
    segments.push({ type: 'vector', nodes: uniqueNodes });
    currentVectorNodes = [];
  }

  function visit(node) {
    if (!node || node.visible === false) return;

    if (nodeNeedsRaster(node)) {
      flushVector();
      segments.push({ type: 'raster', nodes: collectSubtreeNodes(node) });
      return;
    }

    if (nodeHasRenderableSelf(node)) {
      currentVectorNodes.push(node);
    }

    if ('children' in node && node.children && node.children.length > 0) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  if (frame && 'children' in frame && frame.children) {
    for (const child of frame.children) {
      visit(child);
    }
  }

  flushVector();
  return segments;
}

function captureNodeState(nodes) {
  const visibility = new Map();
  const fills = new Map();
  const strokes = new Map();

  for (const node of nodes) {
    visibility.set(node.id, node.visible);
    if ('fills' in node && node.fills !== figma.mixed) {
      fills.set(node.id, node.fills);
    }
    if ('strokes' in node && node.strokes !== figma.mixed) {
      strokes.set(node.id, node.strokes);
    }
  }

  return { visibility, fills, strokes };
}

function restoreNodeState(nodes, state) {
  for (const node of nodes) {
    if (state.visibility.has(node.id)) {
      node.visible = state.visibility.get(node.id);
    }
    if (state.fills.has(node.id)) {
      node.fills = state.fills.get(node.id);
    }
    if (state.strokes.has(node.id)) {
      node.strokes = state.strokes.get(node.id);
    }
  }
}

function applySegmentState(frame, nodes, segmentNodes, state) {
  const renderSet = new Set();
  for (const node of segmentNodes) {
    renderSet.add(node.id);
  }

  const showSet = new Set();
  for (const node of segmentNodes) {
    showSet.add(node.id);
    for (const ancestor of getAncestorChain(node, frame)) {
      showSet.add(ancestor.id);
    }
  }

  for (const node of nodes) {
    const originalVisible = state.visibility.get(node.id) !== false;
    node.visible = originalVisible && showSet.has(node.id);

    if ('fills' in node && node.fills !== figma.mixed) {
      if (renderSet.has(node.id)) {
        if (state.fills.has(node.id)) {
          node.fills = state.fills.get(node.id);
        }
      } else {
        node.fills = [];
      }
    }

    if ('strokes' in node && node.strokes !== figma.mixed) {
      if (renderSet.has(node.id)) {
        if (state.strokes.has(node.id)) {
          node.strokes = state.strokes.get(node.id);
        }
      } else {
        node.strokes = [];
      }
    }
  }
}
/**
 * Detailed layer analysis - determines if individual layers need rasterization
 * Following Figma's approach: keep vectors where possible, rasterize only what's needed
 */
async function analyzeFrameLayers(node, depth = 0, results = null) {
  if (results === null) {
    results = {
      totalLayers: 0,
      vectorLayers: 0,
      rasterLayers: 0,
      details: [],
      hasCriticalEffects: false,
      frameStrategy: 'vector' // vector, hybrid, or raster
    };
  }

  const indent = '  '.repeat(depth);
  let layerNeedsRaster = false;
  const layerIssues = [];

  // Analyze this layer
  if (node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
    results.totalLayers++;

    // Check for effects that MUST be rasterized
    if (node.effects && node.effects.length > 0) {
      for (const effect of node.effects) {
        if (effect.visible !== false) {
          if (MUST_RASTERIZE_EFFECTS.includes(effect.type)) {
            layerNeedsRaster = true;
            results.hasCriticalEffects = true;
            layerIssues.push({
              type: 'CRITICAL_EFFECT',
              effect: effect.type,
              reason: 'Cannot be represented as vector'
            });
            console.log(indent + `🔴 MUST RASTERIZE: "${node.name}" has ${effect.type}`);
          } else if (SHOULD_RASTERIZE_EFFECTS.includes(effect.type)) {
            // Shadows can sometimes work as vector, but quality is better rasterized
            layerIssues.push({
              type: 'SHADOW_EFFECT',
              effect: effect.type,
              reason: 'Better quality when rasterized'
            });
            console.log(indent + `🟡 Recommended raster: "${node.name}" has ${effect.type}`);
          }
        }
      }
    }

    // Check blend modes
    if (node.blendMode && PROBLEMATIC_BLEND_MODES.includes(node.blendMode)) {
      layerNeedsRaster = true;
      layerIssues.push({
        type: 'BLEND_MODE',
        mode: node.blendMode,
        reason: 'Not fully supported in PDF'
      });
      console.log(indent + `🔴 MUST RASTERIZE: "${node.name}" has blend mode ${node.blendMode}`);
    }

    // Check for masks with effects
    if (node.isMask && node.effects && node.effects.length > 0) {
      layerNeedsRaster = true;
      layerIssues.push({
        type: 'MASKED_EFFECTS',
        reason: 'Mask + effects combination'
      });
    }

    // Record this layer's status
    if (layerNeedsRaster) {
      results.rasterLayers++;
      results.details.push({
        name: node.name,
        type: node.type,
        needsRaster: true,
        issues: layerIssues,
        depth: depth
      });
    } else if (layerIssues.length > 0) {
      // Layer can be vector but has minor issues
      results.vectorLayers++;
      results.details.push({
        name: node.name,
        type: node.type,
        needsRaster: false,
        warnings: layerIssues,
        depth: depth
      });
    } else {
      // Pure vector layer
      results.vectorLayers++;
      console.log(indent + `✅ VECTOR: "${node.name}" (${node.type})`);
    }
  }

  // Recursively analyze children
  if ('children' in node && node.children) {
    for (const child of node.children) {
      await analyzeFrameLayers(child, depth + 1, results);
    }
  }

  // Determine overall strategy (only at root level)
  if (depth === 0) {
    if (results.rasterLayers === 0) {
      results.frameStrategy = 'vector';
      console.log(`📊 Frame is 100% VECTOR SAFE (${results.vectorLayers} layers)`);
    } else if (results.vectorLayers === 0) {
      results.frameStrategy = 'raster';
      console.log(`📊 Frame is 100% RASTER (${results.rasterLayers} layers)`);
    } else {
      results.frameStrategy = 'hybrid';
      console.log(`📊 Frame is HYBRID: ${results.vectorLayers} vector, ${results.rasterLayers} raster`);
    }
  }

  return results;
}

/**
 * Simplified detection for backward compatibility
 * Returns issues array in the old format
 */
async function scanForProblematicEffects(node, depth = 0) {
  const analysis = await analyzeFrameLayers(node, 0);

  // Convert to old format for compatibility
  const issues = [];

  for (const detail of analysis.details) {
    if (detail.needsRaster || detail.warnings) {
      const layerIssues = detail.needsRaster ? detail.issues : detail.warnings;

      for (const issue of layerIssues) {
        issues.push({
          nodeName: detail.name,
          nodeType: detail.type,
          issue: issue.effect || issue.mode || issue.type,
          severity: issue.type === 'CRITICAL_EFFECT' || issue.type === 'BLEND_MODE' ? 'high' :
                   issue.type === 'SHADOW_EFFECT' ? 'medium' : 'low',
          reason: issue.reason
        });
      }
    }
  }

  return issues;
}

/**
 * Determine export strategy with hybrid support
 * Following Figma's approach: vector when possible, PNG only when needed
 */
function determineExportStrategy(issues, layerAnalysis = null) {
  // Use detailed layer analysis if available
  if (layerAnalysis) {
    const { frameStrategy, vectorLayers, rasterLayers, hasCriticalEffects } = layerAnalysis;

    if (frameStrategy === 'vector') {
      return {
        strategy: 'vector',
        reason: `100% vector safe (${vectorLayers} layers)`,
        stats: { vectorLayers, rasterLayers, total: vectorLayers + rasterLayers }
      };
    } else if (frameStrategy === 'raster') {
      return {
        strategy: 'png',
        reason: `All layers need rasterization (${rasterLayers} layers)`,
        stats: { vectorLayers, rasterLayers, total: vectorLayers + rasterLayers }
      };
    } else {
      // Hybrid case - for now, we'll use PNG if there are critical effects
      // In future, could implement true layer-by-layer hybrid
      if (hasCriticalEffects) {
        return {
          strategy: 'png',
          reason: `Hybrid frame with critical effects (${vectorLayers} vector, ${rasterLayers} raster) - using high-quality PNG`,
          stats: { vectorLayers, rasterLayers, total: vectorLayers + rasterLayers }
        };
      } else {
        return {
          strategy: 'vector-with-fallback',
          reason: `Hybrid frame (${vectorLayers} vector, ${rasterLayers} raster) - attempting vector with PNG fallback`,
          stats: { vectorLayers, rasterLayers, total: vectorLayers + rasterLayers }
        };
      }
    }
  }

  // Fallback to old logic if no layer analysis
  if (issues.length === 0) {
    return { strategy: 'vector', reason: 'No problematic effects detected' };
  }

  const highSeverityCount = issues.filter(i => i.severity === 'high').length;
  const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length;

  if (highSeverityCount > 0) {
    return {
      strategy: 'png',
      reason: `${highSeverityCount} critical issue(s) requiring rasterization`,
      issues: issues
    };
  }

  if (mediumSeverityCount >= 3) {
    return {
      strategy: 'png',
      reason: `${mediumSeverityCount} issues - better quality with PNG`,
      issues: issues
    };
  }

  return {
    strategy: 'vector-with-fallback',
    reason: `${issues.length} minor issue(s) - attempting vector with PNG fallback`,
    issues: issues
  };
}

// ============================================================================
// PDF VALIDATION
// ============================================================================

// Validate PDF data structure after export
function validatePDFData(pdfData, frameName) {
  const validationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // Check minimum size
  if (!pdfData || pdfData.length < 100) {
    validationResult.isValid = false;
    validationResult.errors.push(`PDF too small (${pdfData ? pdfData.length : 0} bytes)`);
    return validationResult;
  }

  // Check PDF header signature
  const header = String.fromCharCode(pdfData[0], pdfData[1], pdfData[2], pdfData[3], pdfData[4]);
  if (!header.startsWith('%PDF')) {
    validationResult.isValid = false;
    validationResult.errors.push(`Invalid PDF header: "${header}"`);
    return validationResult;
  }

  // Check for EOF marker (should be near the end)
  const tailLength = Math.min(100, pdfData.length);
  const tailBytes = pdfData.slice(-tailLength);
  const tailStr = String.fromCharCode.apply(null, tailBytes);

  if (!tailStr.includes('%%EOF')) {
    validationResult.warnings.push('Missing %%EOF marker - PDF may be truncated');
  }

  // Check for required PDF structures in first 2KB
  const headerLength = Math.min(2000, pdfData.length);
  const headerBytes = pdfData.slice(0, headerLength);
  const headerStr = String.fromCharCode.apply(null, headerBytes);

  // Look for signs of a valid PDF structure
  const hasObj = headerStr.includes(' obj') || headerStr.includes('\nobj');
  const hasStream = headerStr.includes('stream');

  if (!hasObj) {
    validationResult.warnings.push('No PDF objects found in header - structure may be malformed');
  }

  // Check for common corruption patterns
  if (headerStr.includes('undefined') || headerStr.includes('NaN')) {
    validationResult.isValid = false;
    validationResult.errors.push('PDF contains JavaScript error artifacts (undefined/NaN)');
  }

  // Check for suspiciously repetitive data (sign of encoding error)
  const middleStart = Math.floor(pdfData.length / 2);
  const sampleSize = Math.min(100, pdfData.length - middleStart);
  const middleSample = pdfData.slice(middleStart, middleStart + sampleSize);

  let repetitionCount = 0;
  for (let i = 1; i < middleSample.length; i++) {
    if (middleSample[i] === middleSample[i-1]) repetitionCount++;
  }

  if (repetitionCount > sampleSize * 0.8) {
    validationResult.warnings.push('PDF contains highly repetitive data - may be corrupted');
  }

  // Log validation result
  if (validationResult.isValid) {
    if (validationResult.warnings.length > 0) {
      console.log(`⚠️ PDF validation for "${frameName}": passed with warnings - ${validationResult.warnings.join(', ')}`);
    } else {
      console.log(`✓ PDF validation for "${frameName}": passed`);
    }
  } else {
    console.error(`✗ PDF validation for "${frameName}" FAILED: ${validationResult.errors.join(', ')}`);
  }

  return validationResult;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

// Export selected frames to PDF with quality support and batch handling
async function exportToPDF(frameOrder, selectedFrameIds, qualityScale = 1.5, qualityString = 'high', exportType = 'raster') {
  try {
    const selectedFrames = frameData.filter(frame => selectedFrameIds.includes(frame.id));
    const orderedFrames = frameOrder.map(id => selectedFrames.find(frame => frame.id === id)).filter(Boolean);

    // Vector export doesn't need batching (no memory concerns for frame data)
    if (exportType === 'vector') {
      console.log('Starting HYBRID vector/PNG PDF export for', orderedFrames.length, 'frames at quality scale', qualityScale);
      await performVectorExport(orderedFrames, frameOrder, selectedFrameIds, qualityScale);
      return;
    }

    // Raster export - existing batching logic
    // Calculate memory requirements and determine if batching is needed
    const BYTES_PER_PIXEL = 4; // RGBA
    const SAFE_MEMORY_LIMIT = 400 * 1024 * 1024; // 400MB limit

    // Lower quality = better compression (less detail = smaller files)
    let PNG_COMPRESSION_ESTIMATE;
    if (qualityScale >= 3.0) {
      PNG_COMPRESSION_ESTIMATE = 0.50;
    } else if (qualityScale >= 2.0) {
      PNG_COMPRESSION_ESTIMATE = 0.45;
    } else if (qualityScale >= 1.5) {
      PNG_COMPRESSION_ESTIMATE = 0.35;
    } else if (qualityScale >= 1.0) {
      PNG_COMPRESSION_ESTIMATE = 0.30;
    } else {
      PNG_COMPRESSION_ESTIMATE = 0.25;
    }

    console.log('Using memory limit:', (SAFE_MEMORY_LIMIT / 1024 / 1024).toFixed(0) + 'MB',
                'PNG compression estimate:', (PNG_COMPRESSION_ESTIMATE * 100) + '%',
                'for quality scale:', qualityScale);

    let totalEstimatedMemory = 0;
    const frameMemoryEstimates = [];

    for (const frame of orderedFrames) {
      const scaledWidth = frame.width * qualityScale;
      const scaledHeight = frame.height * qualityScale;
      const estimatedBytes = scaledWidth * scaledHeight * BYTES_PER_PIXEL * PNG_COMPRESSION_ESTIMATE;

      frameMemoryEstimates.push({
        frame: frame,
        estimatedBytes: estimatedBytes
      });

      totalEstimatedMemory += estimatedBytes;
    }

    console.log('Memory estimate:', {
      totalMB: (totalEstimatedMemory / 1024 / 1024).toFixed(2),
      limitMB: (SAFE_MEMORY_LIMIT / 1024 / 1024).toFixed(2),
      frameCount: orderedFrames.length,
      scale: qualityScale
    });

    // Check if batching is needed
    if (totalEstimatedMemory > SAFE_MEMORY_LIMIT) {
      let batches = [];
      let currentBatch = [];
      let currentBatchMemory = 0;

      for (const frameEst of frameMemoryEstimates) {
        if (currentBatchMemory + frameEst.estimatedBytes > SAFE_MEMORY_LIMIT && currentBatch.length > 0) {
          batches.push(currentBatch.slice());
          currentBatch = [frameEst.frame];
          currentBatchMemory = frameEst.estimatedBytes;
        } else {
          currentBatch.push(frameEst.frame);
          currentBatchMemory += frameEst.estimatedBytes;
        }
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      figma.ui.postMessage({
        type: 'batch-warning',
        totalMemoryMB: (totalEstimatedMemory / 1024 / 1024).toFixed(1),
        limitMB: (SAFE_MEMORY_LIMIT / 1024 / 1024).toFixed(1),
        batchCount: batches.length,
        batches: batches.map((batch, idx) => ({
          batchNumber: idx + 1,
          frameCount: batch.length,
          frameNames: batch.map(f => f.name)
        })),
        exportData: {
          frameOrder: frameOrder,
          selectedFrameIds: selectedFrameIds,
          qualityScale: qualityScale,
          qualityString: qualityString
        }
      });

      return;
    }

    await performExport(orderedFrames, frameOrder, selectedFrameIds, qualityScale, qualityString, null, 'raster');

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to export frames: ' + error.message
    });
  }
}

// Perform hybrid vector/PNG PDF export with detailed layer analysis
// Perform hybrid vector/PNG PDF export - SIMPLIFIED VERSION
// Due to pdf-lib limitations with Figma PDFs, we export as PNG but with smart analysis
// Perform hybrid vector/PNG PDF export with MuPDF.js
async function performVectorExport(orderedFrames, frameOrder, selectedFrameIds, pngFallbackScale = 1.5) {
  console.log('═══════════════════════════════════════════════════');
  console.log('HYBRID VECTOR/PNG EXPORT with MuPDF.js');
  console.log('  Frames:', orderedFrames.length);
  console.log('  PNG fallback quality:', pngFallbackScale + 'x');
  console.log('═══════════════════════════════════════════════════');

  figma.ui.postMessage({
    type: 'vector-export-progress',
    message: 'Analyzing frames for vector compatibility...',
    current: 0,
    total: orderedFrames.length
  });

  const exportResults = [];
  const frameAnalysis = [];

  // Phase 1: Detailed layer analysis
  console.log('\n--- PHASE 1: Layer-by-Layer Analysis ---');
  for (let i = 0; i < orderedFrames.length; i++) {
    const frameInfo = orderedFrames[i];
    const frame = await figma.getNodeByIdAsync(frameInfo.id);

    if (!frame || frame.type !== 'FRAME') {
      frameAnalysis.push({
        frameInfo: frameInfo,
        strategy: 'skip',
        reason: 'Frame not found or invalid type'
      });
      continue;
    }

    figma.ui.postMessage({
      type: 'vector-export-progress',
      message: `Analyzing ${i + 1}/${orderedFrames.length}: ${frameInfo.name}`,
      current: i,
      total: orderedFrames.length,
      phase: 'analysis'
    });

    const layerAnalysis = await analyzeFrameLayers(frame);
    const decision = determineExportStrategy([], layerAnalysis);

    frameAnalysis.push({
      frameInfo: frameInfo,
      frame: frame,
      layerAnalysis: layerAnalysis,
      strategy: decision.strategy,
      reason: decision.reason,
      stats: decision.stats
    });

    console.log(`Frame "${frameInfo.name}":`);
    console.log(`  Strategy: ${decision.strategy}`);
    console.log(`  Reason: ${decision.reason}`);
    if (decision.stats) {
      console.log(`  Layers: ${decision.stats.vectorLayers} vector, ${decision.stats.rasterLayers} raster`);
    }
  }

  // Phase 2: Export based on strategy (PDF or PNG)
  console.log('\n--- PHASE 2: Export ---');

  let totalVectorLayers = 0;
  let totalRasterLayers = 0;

  for (let i = 0; i < frameAnalysis.length; i++) {
    const analysis = frameAnalysis[i];
    const frameInfo = analysis.frameInfo;

    if (analysis.strategy === 'skip') {
      exportResults.push({
        id: frameInfo.id,
        name: frameInfo.name,
        width: frameInfo.width,
        height: frameInfo.height,
        error: analysis.reason,
        skipped: true
      });
      continue;
    }

    figma.ui.postMessage({
      type: 'vector-export-progress',
      message: `Exporting ${i + 1}/${orderedFrames.length}: ${frameInfo.name}`,
      current: i + 1,
      total: orderedFrames.length,
      phase: 'export',
      strategy: analysis.strategy
    });

    const frame = analysis.frame;

    // Count layer stats
    if (analysis.stats) {
      totalVectorLayers += analysis.stats.vectorLayers || 0;
      totalRasterLayers += analysis.stats.rasterLayers || 0;
    }

    const hasRasterLayers = analysis.layerAnalysis && analysis.layerAnalysis.rasterLayers > 0;

    if (hasRasterLayers) {
      console.log(`🧩 Layered export: "${frameInfo.name}" (${analysis.reason})`);

      if (analysis.layerAnalysis && analysis.layerAnalysis.vectorLayers === 0) {
        console.log(`📷 PNG Export: "${frameInfo.name}" (all raster layers)`);
        try {
          const pngData = await frame.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: pngFallbackScale }
          });
          exportResults.push({
            id: frameInfo.id,
            name: frameInfo.name,
            width: frameInfo.width,
            height: frameInfo.height,
            pngData: pngData,
            isPng: true,
            reason: 'All layers rasterized',
            layerStats: analysis.stats
          });
          console.log(`✓ PNG: ${pngData.length} bytes`);
        } catch (error) {
          console.error(`✗ PNG export failed:`, error);
          exportResults.push({
            id: frameInfo.id,
            name: frameInfo.name,
            width: frameInfo.width,
            height: frameInfo.height,
            error: error.message,
            skipped: true
          });
        }
        continue;
      }

      const segments = buildFrameSegments(frame);
      const hasRasterSegments = segments.some(segment => segment.type === 'raster');

      if (!hasRasterSegments) {
        console.log(`📄 Vector PDF Export: "${frameInfo.name}" (no raster segments detected)`);
        try {
          const pdfData = await frame.exportAsync({ format: 'PDF' });
          exportResults.push({
            id: frameInfo.id,
            name: frameInfo.name,
            width: frameInfo.width,
            height: frameInfo.height,
            pdfData: pdfData,
            isPng: false,
            layerStats: analysis.stats
          });
          console.log(`✓ Vector PDF: ${pdfData.length} bytes`);
        } catch (error) {
          console.error(`✗ Vector PDF export failed, trying PNG fallback:`, error);
          try {
            const pngData = await frame.exportAsync({
              format: 'PNG',
              constraint: { type: 'SCALE', value: pngFallbackScale }
            });
            exportResults.push({
              id: frameInfo.id,
              name: frameInfo.name,
              width: frameInfo.width,
              height: frameInfo.height,
              pngData: pngData,
              isPng: true,
              reason: `PDF export failed: ${error.message}`,
              layerStats: analysis.stats
            });
            console.log(`✓ PNG fallback: ${pngData.length} bytes`);
          } catch (pngError) {
            console.error(`✗ PNG fallback also failed:`, pngError);
            exportResults.push({
              id: frameInfo.id,
              name: frameInfo.name,
              width: frameInfo.width,
              height: frameInfo.height,
              error: `Both PDF and PNG failed: ${error.message}`,
              skipped: true
            });
          }
        }
        continue;
      }

      const nodes = collectAllNodes(frame);
      const state = captureNodeState(nodes);
      const segmentExports = [];
      const hasFrameBackground = ('fills' in frame && hasVisiblePaints(frame.fills)) ||
                                 ('strokes' in frame && hasVisiblePaints(frame.strokes));

      try {
        if (hasFrameBackground) {
          applySegmentState(frame, nodes, [frame], state);
          const bgPdf = await frame.exportAsync({ format: 'PDF' });
          segmentExports.push({
            type: 'vector',
            pdfData: bgPdf,
            reason: 'frame background'
          });
          console.log(`✓ Background vector segment: ${bgPdf.length} bytes`);
        }

        for (let s = 0; s < segments.length; s++) {
          const segment = segments[s];
          applySegmentState(frame, nodes, segment.nodes, state);

          if (segment.type === 'raster') {
            const pngData = await frame.exportAsync({
              format: 'PNG',
              constraint: { type: 'SCALE', value: pngFallbackScale }
            });
            segmentExports.push({
              type: 'png',
              pngData: pngData
            });
            console.log(`✓ Raster segment ${s + 1}/${segments.length}: ${pngData.length} bytes`);
          } else {
            const pdfData = await frame.exportAsync({ format: 'PDF' });
            segmentExports.push({
              type: 'vector',
              pdfData: pdfData
            });
            console.log(`✓ Vector segment ${s + 1}/${segments.length}: ${pdfData.length} bytes`);
          }
        }

        exportResults.push({
          id: frameInfo.id,
          name: frameInfo.name,
          width: frameInfo.width,
          height: frameInfo.height,
          segments: segmentExports,
          layerStats: analysis.stats
        });
      } catch (error) {
        console.error(`✗ Layered export failed:`, error);
        exportResults.push({
          id: frameInfo.id,
          name: frameInfo.name,
          width: frameInfo.width,
          height: frameInfo.height,
          error: `Layered export failed: ${error.message}`,
          skipped: true
        });
      } finally {
        restoreNodeState(nodes, state);
      }
    } else {
      // Export as vector PDF
      console.log(`📄 Vector PDF Export: "${frameInfo.name}" (${analysis.reason})`);

      try {
        const pdfData = await frame.exportAsync({ format: 'PDF' });

        exportResults.push({
          id: frameInfo.id,
          name: frameInfo.name,
          width: frameInfo.width,
          height: frameInfo.height,
          pdfData: pdfData,
          isPng: false,
          layerStats: analysis.stats
        });

        console.log(`✓ Vector PDF: ${pdfData.length} bytes`);

      } catch (error) {
        console.error(`✗ Vector PDF export failed, trying PNG fallback:`, error);

        try {
          const pngData = await frame.exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: pngFallbackScale }
          });

          exportResults.push({
            id: frameInfo.id,
            name: frameInfo.name,
            width: frameInfo.width,
            height: frameInfo.height,
            pngData: pngData,
            isPng: true,
            reason: `PDF export failed: ${error.message}`,
            layerStats: analysis.stats
          });

          console.log(`✓ PNG fallback: ${pngData.length} bytes`);
        } catch (pngError) {
          console.error(`✗ PNG fallback also failed:`, pngError);
          exportResults.push({
            id: frameInfo.id,
            name: frameInfo.name,
            width: frameInfo.width,
            height: frameInfo.height,
            error: `Both PDF and PNG failed: ${error.message}`,
            skipped: true
          });
        }
      }
    }
  }

  // Summary
  const successfulExports = exportResults.filter(r => !r.skipped);
  const pngExports = exportResults.filter(r => r.isPng);
  const vectorExports = exportResults.filter(r => r.pdfData && !r.isPng);
  let pngSegments = 0;
  let vectorSegments = 0;
  for (const result of exportResults) {
    if (result.segments) {
      for (const segment of result.segments) {
        if (segment.type === 'png') {
          pngSegments++;
        } else if (segment.type === 'vector') {
          vectorSegments++;
        }
      }
    }
  }
  const failedExports = exportResults.filter(r => r.skipped);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('HYBRID EXPORT SUMMARY:');
  console.log(`  Total pages: ${orderedFrames.length}`);
  console.log(`  Pure vector PDFs: ${vectorExports.length}`);
  console.log(`  High-quality PNGs: ${pngExports.length} (@ ${pngFallbackScale}x)`);
  if (vectorSegments > 0 || pngSegments > 0) {
    console.log(`  Vector segments: ${vectorSegments}`);
    console.log(`  Raster segments: ${pngSegments}`);
  }
  console.log(`  Failed: ${failedExports.length}`);
  console.log(`  Total layers kept as vector: ${totalVectorLayers}`);
  console.log(`  Total layers rasterized: ${totalRasterLayers}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (successfulExports.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No frames could be exported. Try using Rasterized mode.'
    });
    return;
  }

  // Filter connections
  const exportedFrameIds = successfulExports.map(b => b.id);
  const relevantConnections = connections.filter(conn =>
    exportedFrameIds.includes(conn.fromFrameId) &&
    (conn.type === 'external' || exportedFrameIds.includes(conn.toFrameId))
  );

  console.log(`Sending ${successfulExports.length} exports to MuPDF.js (${vectorExports.length} vector, ${pngExports.length} PNG)`);

  const summary = {
    total: orderedFrames.length,
    vector: vectorExports.length,
    png: pngExports.length,
    vectorSegments: vectorSegments,
    rasterSegments: pngSegments,
    failed: failedExports.length,
    vectorLayers: totalVectorLayers,
    rasterLayers: totalRasterLayers,
    quality: pngFallbackScale
  };

  const getByteLength = (value) => {
    if (!value) return 0;
    if (typeof value.byteLength === 'number') return value.byteLength;
    if (typeof value.length === 'number') return value.length;
    return 0;
  };

  const estimateExportBytes = (result) => {
    let total = 0;
    total += getByteLength(result.pdfData);
    total += getByteLength(result.pngData);
    if (result.segments) {
      for (const segment of result.segments) {
        total += getByteLength(segment.pdfData);
        total += getByteLength(segment.pngData);
      }
    }
    return total;
  };

  const MAX_CHUNK_BYTES = 20 * 1024 * 1024;
  const exportChunks = [];
  let currentChunk = [];
  let currentBytes = 0;

  for (const result of successfulExports) {
    const size = estimateExportBytes(result);
    if (currentChunk.length > 0 && currentBytes + size > MAX_CHUNK_BYTES) {
      exportChunks.push(currentChunk);
      currentChunk = [result];
      currentBytes = size;
    } else {
      currentChunk.push(result);
      currentBytes += size;
    }
  }

  if (currentChunk.length > 0) {
    exportChunks.push(currentChunk);
  }

  if (exportChunks.length <= 1) {
    figma.ui.postMessage({
      type: 'merge-vector-pdfs',
      pdfBuffers: successfulExports,
      connections: relevantConnections,
      frameOrder: frameOrder,
      failedFrames: failedExports,
      summary: summary
    });
    return;
  }

  figma.ui.postMessage({
    type: 'merge-vector-pdfs-start',
    totalChunks: exportChunks.length,
    totalBuffers: successfulExports.length,
    connections: relevantConnections,
    frameOrder: frameOrder,
    failedFrames: failedExports,
    summary: summary
  });

  for (let i = 0; i < exportChunks.length; i++) {
    figma.ui.postMessage({
      type: 'merge-vector-pdfs-chunk',
      chunkIndex: i + 1,
      totalChunks: exportChunks.length,
      pdfBuffers: exportChunks[i]
    });
  }

  figma.ui.postMessage({
    type: 'merge-vector-pdfs-end'
  });
}

// Handle PNG fallback request from UI (when pdf-lib fails to parse)
async function handlePngFallbackRequest(frameId, frameIndex, qualityScale = 1.5) {
  console.log(`UI requested PNG fallback for frame ${frameId} at ${qualityScale}x quality`);

  const frame = await figma.getNodeByIdAsync(frameId);

  if (!frame || frame.type !== 'FRAME') {
    figma.ui.postMessage({
      type: 'png-fallback-result',
      frameId: frameId,
      frameIndex: frameIndex,
      success: false,
      error: 'Frame not found'
    });
    return;
  }

  try {
    const pngData = await frame.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: qualityScale }
    });

    figma.ui.postMessage({
      type: 'png-fallback-result',
      frameId: frameId,
      frameIndex: frameIndex,
      success: true,
      pngData: pngData,
      width: frame.width,
      height: frame.height,
      name: frame.name
    });

    console.log(`✓ PNG fallback sent for "${frame.name}" at ${qualityScale}x (${pngData.length} bytes)`);
  } catch (error) {
    figma.ui.postMessage({
      type: 'png-fallback-result',
      frameId: frameId,
      frameIndex: frameIndex,
      success: false,
      error: error.message
    });
  }
}

// Perform the actual raster export (extracted for reuse in batch mode)
async function performExport(orderedFrames, frameOrder, selectedFrameIds, qualityScale, qualityString, batchInfo = null, exportType = 'raster') {
  console.log('Exporting PDF with quality scale:', qualityScale, 'quality string:', qualityString, 'type:', exportType);

  const frameImages = [];
  for (let i = 0; i < orderedFrames.length; i++) {
    const frameInfo = orderedFrames[i];
    const frame = await figma.getNodeByIdAsync(frameInfo.id);

    if (frame && frame.type === 'FRAME') {
      const progressMsg = batchInfo
        ? `Exporting batch ${batchInfo.current}/${batchInfo.total}: frame ${i + 1}/${orderedFrames.length}`
        : `Exporting frame ${i + 1}/${orderedFrames.length}`;

      console.log(progressMsg);

      const imageData = await frame.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: qualityScale }
      });

      frameImages.push({
        id: frameInfo.id,
        name: frameInfo.name,
        width: frameInfo.width,
        height: frameInfo.height,
        imageData: imageData
      });
    }
  }

  const relevantConnections = connections.filter(conn =>
    selectedFrameIds.includes(conn.fromFrameId) && (conn.type === 'external' || selectedFrameIds.includes(conn.toFrameId))
  );

  figma.ui.postMessage({
    type: 'generate-pdf',
    frames: frameImages,
    connections: relevantConnections,
    frameOrder: frameOrder,
    quality: qualityString,
    batchInfo: batchInfo
  });
}

// Initialize - start with empty list
figma.ui.postMessage({
  type: 'plugin-ready',
  message: 'Select frames in Figma to add them to the export list'
});
