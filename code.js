// Main plugin code that runs in Figma's sandbox

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
    await exportToPDF(msg.frameOrder, msg.selectedFrames);
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

    // Check for simple hyperlink property
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

    // Check for character-level hyperlinks (rich text) - simplified version
    try {
      if (node.getStyledTextSegments) {
        const segments = node.getStyledTextSegments(['hyperlink']);
        console.log(indent + 'Found ' + segments.length + ' styled text segments');

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          console.log(indent + 'Segment ' + i + ' has hyperlink: ' + (segment.hyperlink ? 'yes' : 'no'));

          if (segment.hyperlink && segment.hyperlink.type === 'URL' && segment.hyperlink.value) {
            const bounds = getAbsoluteBounds(node, frameId);
            console.log(indent + '✅ Found styled text hyperlink: "' + segment.characters.substring(0, 30) + '" -> ' + segment.hyperlink.value);

            connections.push({
              fromFrameId: frameId,
              toUrl: segment.hyperlink.value,
              elementBounds: bounds,
              elementName: node.name || 'Text Link: "' + segment.characters.substring(0, 20) + '"',
              type: 'external'
            });
          }
        }
      } else {
        console.log(indent + 'getStyledTextSegments not available');
      }
    } catch (error) {
      console.log(indent + 'Error checking styled text segments: ' + error.message);
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

// Export selected frames to PDF
async function exportToPDF(frameOrder, selectedFrameIds) {
  try {
    const selectedFrames = frameData.filter(frame => selectedFrameIds.includes(frame.id));

    // Reorder frames according to user's preference
    const orderedFrames = frameOrder.map(id => selectedFrames.find(frame => frame.id === id)).filter(Boolean);

    // Export each frame as image
    const frameImages = [];
    for (const frameInfo of orderedFrames) {
      const frame = await figma.getNodeByIdAsync(frameInfo.id);
      if (frame && frame.type === 'FRAME') {
        const imageData = await frame.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 2 }
        });
        frameImages.push({
          id: frameInfo.id,
          name: frameInfo.name,
          width: frameInfo.width,
          height: frameInfo.height,
          imageData: Array.from(imageData)
        });
      }
    }

    // Filter connections for selected frames only
    const relevantConnections = connections.filter(conn =>
      selectedFrameIds.includes(conn.fromFrameId) && (conn.type === 'external' || selectedFrameIds.includes(conn.toFrameId))
    );

    // Send to UI for PDF generation
    figma.ui.postMessage({
      type: 'generate-pdf',
      frames: frameImages,
      connections: relevantConnections,
      frameOrder: frameOrder
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to export frames: ' + error.message
    });
  }
}

// Initialize - start with empty list
figma.ui.postMessage({
  type: 'plugin-ready',
  message: 'Select frames in Figma to add them to the export list'
});
