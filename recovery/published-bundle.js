const __html__ = "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n  <title>PDF Export with Links</title>\n  <style>\n    /* Light mode variables (default) */\n    :root {\n      --bg-primary: #fff;\n      --bg-secondary: #f8f9fa;\n      --bg-hover: #f8f8f8;\n      --bg-empty: #fff;\n\n      --text-primary: #333;\n      --text-secondary: #666;\n      --text-tertiary: #999;\n\n      --border-primary: #e0e0e0;\n      --border-secondary: #ddd;\n      --border-light: #f0f0f0;\n      --border-section: #e9ecef;\n\n      --accent-blue: #1976d2;\n      --accent-blue-hover: #1565c0;\n      --accent-blue-bg: #e3f2fd;\n      --accent-blue-border: #90caf9;\n\n      --accent-green-bg: #e8f5e8;\n      --accent-green-text: #2e7d2e;\n      --accent-green-border: #a5d6a5;\n      --accent-green: #4caf50;\n\n      --accent-red-bg: #ffe6e6;\n      --accent-red-text: #d32f2f;\n      --accent-red-border: #ffb3b3;\n      --accent-red: #ff4444;\n\n      --accent-purple-bg: #f3e5f5;\n      --accent-purple-text: #7b1fa2;\n      --accent-purple-border: #ce93d8;\n\n      --accent-orange-bg: #fff3e0;\n      --accent-orange-text: #e65100;\n      --accent-orange-border: #ffcc80;\n\n      --button-disabled: #ccc;\n      --button-secondary-bg: #f5f5f5;\n      --button-secondary-hover: #eeeeee;\n\n      --shadow-toggle: 0 2px 8px rgba(0, 0, 0, 0.1);\n    }\n\n    /* Dark mode variables */\n    [data-theme=\"dark\"] {\n      --bg-primary: #1e1e1e;\n      --bg-secondary: #2a2a2a;\n      --bg-hover: #333;\n      --bg-empty: #252525;\n\n      --text-primary: #e0e0e0;\n      --text-secondary: #a0a0a0;\n      --text-tertiary: #707070;\n\n      --border-primary: #404040;\n      --border-secondary: #505050;\n      --border-light: #353535;\n      --border-section: #3a3a3a;\n\n      --accent-blue: #2196f3;\n      --accent-blue-hover: #1976d2;\n      --accent-blue-bg: #1e3a5f;\n      --accent-blue-border: #2c5282;\n\n      --accent-green-bg: #1b3a1b;\n      --accent-green-text: #66bb6a;\n      --accent-green-border: #2e7d32;\n      --accent-green: #4caf50;\n\n      --accent-red-bg: #3a1b1b;\n      --accent-red-text: #ef5350;\n      --accent-red-border: #7d2e2e;\n      --accent-red: #f44336;\n\n      --accent-purple-bg: #2e1a33;\n      --accent-purple-text: #ba68c8;\n      --accent-purple-border: #7b1fa2;\n\n      --accent-orange-bg: #3a2a1a;\n      --accent-orange-text: #ffb74d;\n      --accent-orange-border: #e65100;\n\n      --button-disabled: #555;\n      --button-secondary-bg: #333;\n      --button-secondary-hover: #404040;\n\n      --shadow-toggle: 0 2px 8px rgba(0, 0, 0, 0.3);\n    }\n\n    * {\n      transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;\n    }\n\n    body {\n      margin: 0;\n      padding: 16px;\n      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n      font-size: 14px;\n      background: var(--bg-primary);\n      color: var(--text-primary);\n    }\n\n    .controls-top {\n      display: flex;\n      justify-content: space-between;\n      align-items: center;\n      gap: 8px;\n      margin-bottom: 16px;\n      padding-bottom: 16px;\n      border-bottom: 1px solid var(--border-primary);\n    }\n\n    .controls-top .btn {\n      padding: 8px 12px;\n      font-size: 12px;\n    }\n\n    .controls-top .left-controls {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n    }\n\n    .sort-select {\n      padding: 8px 12px;\n      padding-right: 28px;\n      border: 1px solid var(--border-secondary);\n      border-radius: 4px;\n      font-size: 12px;\n      background: var(--bg-primary);\n      color: var(--text-primary);\n      cursor: pointer;\n      appearance: none;\n      background-image: url(\"data:image/svg+xml;charset=UTF-8,%3csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3e%3c/svg%3e\");\n      background-repeat: no-repeat;\n      background-position: right 8px center;\n    }\n\n    [data-theme=\"dark\"] .sort-select {\n      background-image: url(\"data:image/svg+xml;charset=UTF-8,%3csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23aaa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3e%3c/svg%3e\");\n    }\n\n    /* Theme toggle switch */\n    .theme-toggle {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n    }\n\n    .theme-toggle-label {\n      font-size: 12px;\n      color: var(--text-secondary);\n      user-select: none;\n      display: flex;\n      align-items: center;\n      gap: 6px;\n    }\n\n    .theme-icon {\n      font-size: 14px;\n    }\n\n    .switch {\n      position: relative;\n      display: inline-block;\n      width: 44px;\n      height: 24px;\n    }\n\n    .switch input {\n      opacity: 0;\n      width: 0;\n      height: 0;\n    }\n\n    .slider {\n      position: absolute;\n      cursor: pointer;\n      top: 0;\n      left: 0;\n      right: 0;\n      bottom: 0;\n      background-color: var(--border-secondary);\n      transition: .3s;\n      border-radius: 24px;\n    }\n\n    .slider:before {\n      position: absolute;\n      content: \"\";\n      height: 18px;\n      width: 18px;\n      left: 3px;\n      bottom: 3px;\n      background-color: var(--bg-primary);\n      transition: .3s;\n      border-radius: 50%;\n      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);\n    }\n\n    input:checked + .slider {\n      background-color: var(--accent-blue);\n    }\n\n    input:checked + .slider:before {\n      transform: translateX(20px);\n    }\n\n    .frame-list {\n      border: 1px solid var(--border-primary);\n      border-radius: 4px;\n      max-height: 360px;\n      overflow-y: auto;\n      background: var(--bg-primary);\n      margin-bottom: 16px;\n    }\n\n    .frame-item {\n      display: flex;\n      align-items: center;\n      padding: 12px;\n      border-bottom: 1px solid var(--border-light);\n      cursor: move;\n      user-select: none;\n      transition: background 0.2s;\n      position: relative;\n    }\n\n    .frame-item:last-child {\n      border-bottom: none;\n    }\n\n    .frame-item:hover {\n      background: var(--bg-hover);\n    }\n\n    .frame-item.dragging {\n      opacity: 0.5;\n      background: var(--accent-blue-bg);\n    }\n\n    .frame-item.drag-over {\n      background: var(--accent-green-bg);\n      border-top: 2px solid var(--accent-green);\n    }\n\n    .frame-item.just-added {\n      animation: highlight 2s ease-out;\n    }\n\n    @keyframes highlight {\n      0% {\n        background: var(--accent-green-bg);\n        border-left: 3px solid var(--accent-green);\n      }\n      100% {\n        background: transparent;\n        border-left: none;\n      }\n    }\n\n    .frame-item.selected-in-figma {\n      background: var(--accent-blue-bg);\n      border-left: 3px solid var(--accent-blue);\n    }\n\n    .frame-checkbox {\n      margin-right: 12px;\n      accent-color: var(--accent-blue);\n    }\n\n    .frame-info {\n      flex: 1;\n    }\n\n    .frame-name {\n      font-weight: 500;\n      color: var(--text-primary);\n      margin-bottom: 2px;\n    }\n\n    .frame-meta {\n      font-size: 11px;\n      color: var(--text-secondary);\n    }\n\n    .connections-count {\n      font-size: 11px;\n      background: var(--accent-blue-bg);\n      color: var(--accent-blue);\n      padding: 2px 6px;\n      border-radius: 10px;\n      margin-left: 8px;\n    }\n\n    .no-links {\n      font-size: 11px;\n      background: var(--bg-secondary);\n      color: var(--text-secondary);\n      padding: 2px 6px;\n      border-radius: 10px;\n      margin-left: 8px;\n    }\n\n    .drag-handle {\n      color: var(--text-tertiary);\n      margin-left: 8px;\n      cursor: move;\n    }\n\n    .frame-item .remove-btn {\n      background: var(--accent-red);\n      color: white;\n      border: none;\n      border-radius: 50%;\n      width: 20px;\n      height: 20px;\n      font-size: 12px;\n      cursor: pointer;\n      margin-left: 8px;\n      opacity: 0;\n      transition: opacity 0.2s;\n    }\n\n    .frame-item:hover .remove-btn {\n      opacity: 1;\n    }\n\n    .controls {\n      display: flex;\n      justify-content: space-between;\n      gap: 8px;\n      margin-top: 0;\n      align-items: center;\n    }\n\n    .btn {\n      padding: 10px 16px;\n      border: none;\n      border-radius: 4px;\n      font-size: 13px;\n      font-weight: 500;\n      cursor: pointer;\n      transition: all 0.2s;\n    }\n\n    .btn-primary {\n      background: var(--accent-blue);\n      color: white;\n    }\n\n    .btn-primary:hover:not(:disabled) {\n      background: var(--accent-blue-hover);\n    }\n\n    .btn-primary:disabled {\n      background: var(--button-disabled);\n      cursor: not-allowed;\n      opacity: 0.6;\n    }\n\n    .btn-secondary {\n      background: var(--button-secondary-bg);\n      color: var(--text-primary);\n      border: 1px solid var(--border-secondary);\n    }\n\n    .btn-secondary:hover {\n      background: var(--button-secondary-hover);\n    }\n\n    /* Export panel */\n    .export-panel {\n      display: flex;\n      flex-direction: column;\n      gap: 12px;\n      margin-top: 16px;\n      padding: 12px;\n      background: var(--bg-secondary);\n      border-radius: 6px;\n      border: 1px solid var(--border-primary);\n    }\n\n    .export-type-selector {\n      display: flex;\n      align-items: center;\n    }\n\n    .export-type-options {\n      display: inline-flex;\n      border: 1px solid var(--border-primary);\n      border-radius: 6px;\n      overflow: hidden;\n      background: var(--bg-primary);\n    }\n\n    .export-type-option {\n      display: flex;\n      align-items: center;\n      position: relative;\n    }\n\n    .export-type-option input[type=\"radio\"] {\n      position: absolute;\n      opacity: 0;\n      pointer-events: none;\n    }\n\n    .export-type-option label {\n      padding: 6px 14px;\n      font-size: 13px;\n      cursor: pointer;\n      user-select: none;\n      color: var(--text-secondary);\n      border-right: 1px solid var(--border-primary);\n      transition: background 0.2s, color 0.2s;\n    }\n\n    .export-type-option:last-child label {\n      border-right: none;\n    }\n\n    .export-type-option input[type=\"radio\"]:checked + label {\n      background: var(--accent-blue);\n      color: #fff;\n    }\n\n    /* Quality selector styles */\n    .quality-selector {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n    }\n\n    .quality-label {\n      font-size: 13px;\n      color: var(--text-secondary);\n      font-weight: 500;\n    }\n\n    .quality-select {\n      padding: 8px 12px;\n      padding-right: 28px;\n      border: 1px solid var(--border-secondary);\n      border-radius: 4px;\n      font-size: 13px;\n      background: var(--bg-primary);\n      color: var(--text-primary);\n      cursor: pointer;\n      appearance: none;\n      background-image: url(\"data:image/svg+xml;charset=UTF-8,%3csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3e%3c/svg%3e\");\n      background-repeat: no-repeat;\n      background-position: right 8px center;\n      min-width: 180px;\n    }\n\n    .quality-select:disabled {\n      opacity: 0.5;\n      cursor: not-allowed;\n      background-color: var(--bg-secondary);\n    }\n\n    .quality-select optgroup {\n      font-weight: 600;\n      font-size: 12px;\n      color: var(--text-secondary);\n      padding: 4px 0;\n    }\n\n    .quality-select option {\n      padding: 6px 8px;\n      font-size: 13px;\n    }\n\n    [data-theme=\"dark\"] .quality-select {\n      background-image: url(\"data:image/svg+xml;charset=UTF-8,%3csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23aaa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3e%3c/svg%3e\");\n    }\n\n    .quality-select:hover:not(:disabled) {\n      border-color: var(--text-tertiary);\n    }\n\n    .quality-select:focus {\n      outline: none;\n      border-color: var(--accent-blue);\n      box-shadow: 0 0 0 2px var(--accent-blue-bg);\n    }\n\n    .status {\n      margin-top: 0;\n      padding: 12px;\n      border-radius: 4px;\n      font-size: 12px;\n      display: none;\n    }\n\n    .status-title {\n      font-size: 12px;\n      font-weight: 600;\n      margin-bottom: 6px;\n    }\n\n    .status-log {\n      display: flex;\n      flex-direction: column;\n      gap: 4px;\n      max-height: 140px;\n      overflow-y: auto;\n      padding-right: 2px;\n    }\n\n    .status-line {\n      font-size: 12px;\n      color: inherit;\n      opacity: 0.9;\n    }\n\n    .status.success {\n      background: var(--accent-green-bg);\n      color: var(--accent-green-text);\n      border: 1px solid var(--accent-green-border);\n    }\n\n    .status.error {\n      background: var(--accent-red-bg);\n      color: var(--accent-red-text);\n      border: 1px solid var(--accent-red-border);\n    }\n\n    .status.info {\n      background: var(--accent-blue-bg);\n      color: var(--accent-blue);\n      border: 1px solid var(--accent-blue-border);\n    }\n\n    .status.warning {\n      background: var(--accent-orange-bg);\n      color: var(--accent-orange-text);\n      border: 1px solid var(--accent-orange-border);\n    }\n\n    .empty-state {\n      text-align: center;\n      padding: 40px 20px;\n      color: var(--text-secondary);\n      background: var(--bg-empty);\n      border-radius: 4px;\n      margin-bottom: 16px;\n    }\n\n    .empty-icon {\n      font-size: 48px;\n      margin-bottom: 16px;\n      opacity: 0.5;\n    }\n\n    .empty-state h3 {\n      margin: 0 0 8px 0;\n      font-size: 16px;\n      color: var(--text-primary);\n    }\n\n    .empty-state p {\n      margin: 0;\n      font-size: 13px;\n      line-height: 1.4;\n    }\n\n    .selection-info {\n      background: var(--accent-blue-bg);\n      border: 1px solid var(--accent-blue-border);\n      border-radius: 4px;\n      padding: 12px;\n      margin-bottom: 16px;\n      font-size: 12px;\n      color: var(--accent-blue);\n    }\n\n    /* Scrollbar styles for dark mode */\n    [data-theme=\"dark\"] ::-webkit-scrollbar {\n      width: 8px;\n      height: 8px;\n    }\n\n    [data-theme=\"dark\"] ::-webkit-scrollbar-track {\n      background: var(--bg-secondary);\n    }\n\n    [data-theme=\"dark\"] ::-webkit-scrollbar-thumb {\n      background: var(--border-secondary);\n      border-radius: 4px;\n    }\n\n    [data-theme=\"dark\"] ::-webkit-scrollbar-thumb:hover {\n      background: var(--text-tertiary);\n    }\n\n    /* Batch warning modal */\n    .modal-overlay {\n      position: fixed;\n      top: 0;\n      left: 0;\n      right: 0;\n      bottom: 0;\n      background: rgba(0, 0, 0, 0.6);\n      display: none;\n      align-items: center;\n      justify-content: center;\n      z-index: 1000;\n    }\n\n    .modal-overlay.show {\n      display: flex;\n    }\n\n    .modal {\n      background: var(--bg-primary);\n      border-radius: 8px;\n      padding: 24px;\n      max-width: 400px;\n      width: 90%;\n      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);\n      border: 1px solid var(--border-primary);\n    }\n\n    .modal-header {\n      display: flex;\n      align-items: center;\n      gap: 12px;\n      margin-bottom: 16px;\n    }\n\n    .modal-icon {\n      font-size: 24px;\n    }\n\n    .modal-title {\n      font-size: 16px;\n      font-weight: 600;\n      color: var(--text-primary);\n      margin: 0;\n    }\n\n    .modal-content {\n      color: var(--text-secondary);\n      font-size: 13px;\n      line-height: 1.5;\n      margin-bottom: 20px;\n    }\n\n    .modal-content strong {\n      color: var(--text-primary);\n      font-weight: 600;\n    }\n\n    .batch-list {\n      background: var(--bg-secondary);\n      border-radius: 4px;\n      padding: 12px;\n      margin: 12px 0;\n      max-height: 150px;\n      overflow-y: auto;\n    }\n\n    .batch-item {\n      padding: 6px 0;\n      font-size: 12px;\n      color: var(--text-secondary);\n    }\n\n    .modal-actions {\n      display: flex;\n      gap: 8px;\n      justify-content: flex-end;\n    }\n\n    .modal-actions .btn {\n      padding: 8px 16px;\n      font-size: 13px;\n    }\n  </style>\n</head>\n<body data-theme=\"dark\">\n  <div class=\"controls-top\">\n    <div class=\"left-controls\">\n      <button id=\"clear-list-btn\" class=\"btn btn-secondary\">Clear List</button>\n      <select id=\"sort-select\" class=\"sort-select\" title=\"Sort frames\">\n        <option value=\"none\" selected>Sort</option>\n        <option value=\"az\">Name A–Z</option>\n        <option value=\"za\">Name Z–A</option>\n      </select>\n    </div>\n    <div class=\"theme-toggle\">\n      <label class=\"theme-toggle-label\">\n        <span class=\"theme-icon\">🌙</span>\n        <span id=\"theme-label\">Dark</span>\n      </label>\n      <label class=\"switch\">\n        <input type=\"checkbox\" id=\"theme-switch\" checked>\n        <span class=\"slider\"></span>\n      </label>\n    </div>\n  </div>\n\n  <div id=\"frame-list\" class=\"frame-list\" style=\"display: none;\"></div>\n\n  <div id=\"empty-state\" class=\"empty-state\">\n    <h3>Select frames in Figma</h3>\n  </div>\n\n  <div id=\"selection-info\" class=\"selection-info\" style=\"display: none;\"></div>\n\n  <div class=\"export-panel\">\n    <div class=\"export-type-selector\">\n      <div class=\"export-type-options\">\n        <div class=\"export-type-option\">\n          <input type=\"radio\" id=\"export-vector\" name=\"export-type\" value=\"vector\" checked>\n          <label for=\"export-vector\">Vector</label>\n        </div>\n        <div class=\"export-type-option\">\n          <input type=\"radio\" id=\"export-raster\" name=\"export-type\" value=\"raster\">\n          <label for=\"export-raster\">Rasterized</label>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"controls\">\n      <div class=\"quality-selector\">\n        <label class=\"quality-label\" for=\"quality-select\" id=\"quality-label\">Quality:</label>\n        <select id=\"quality-select\" class=\"quality-select\">\n          <optgroup label=\"Screen\">\n            <option value=\"screen-low\">Low (0.5x, 36 DPI)</option>\n            <option value=\"screen-medium\" selected>Medium (1x, 72 DPI)</option>\n            <option value=\"screen-high\">High (1.5x, 108 DPI)</option>\n          </optgroup>\n          <optgroup label=\"Print\">\n            <option value=\"print-low\">Low (2x, 144 DPI)</option>\n            <option value=\"print-medium\">Medium (3x, 216 DPI)</option>\n            <option value=\"print-high\">High (4x, 288 DPI)</option>\n            <option value=\"print-highest\">Highest (4.17x, 300 DPI)</option>\n          </optgroup>\n        </select>\n      </div>\n      <button id=\"export-btn\" class=\"btn btn-primary\" disabled>Export PDF</button>\n    </div>\n\n    <div id=\"status\" class=\"status\">\n      <div id=\"status-title\" class=\"status-title\"></div>\n      <div id=\"status-log\" class=\"status-log\"></div>\n    </div>\n  </div>\n\n  <!"+"-- Batch Warning Modal --"+">\n  <div id=\"batch-modal\" class=\"modal-overlay\">\n    <div class=\"modal\">\n      <div class=\"modal-header\">\n        <div class=\"modal-icon\">⚠️</div>\n        <h3 class=\"modal-title\">High Memory Usage Detected</h3>\n      </div>\n      <div class=\"modal-content\">\n        <p id=\"batch-warning-text\"></p>\n        <div class=\"batch-list\" id=\"batch-list\"></div>\n        <p><strong>Each batch will create a separate PDF file.</strong></p>\n        <p style=\"font-size: 12px; margin-top: 12px;\">💡 Tip: You can reduce quality or export fewer frames to create a single PDF.</p>\n      </div>\n      <div class=\"modal-actions\">\n        <button id=\"batch-cancel-btn\" class=\"btn btn-secondary\">Cancel</button>\n        <button id=\"batch-export-btn\" class=\"btn btn-primary\">Export in Batches</button>\n      </div>\n    </div>\n  </div>\n\n  <!"+"-- Include PDF generation libraries --"+">\n    <script src=\"https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js\"></script>\n    <script src=\"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js\"></script>\n\n    <!"+"-- MuPDF.js for vector PDF merging --"+">\n    <script>\n      // Load MuPDF from unpkg (which is already in allowedDomains)\n      window.mupdfReady = false;\n      window.mupdfLoadError = null;\n\n      window.mupdfLoadPromise = new Promise((resolve, reject) => {\n        console.log('🔄 Loading MuPDF.js from unpkg...');\n\n        const script = document.createElement('script');\n        script.type = 'module';\n        script.textContent = `\n          try {\n            const mupdfModule = await im"+"port('https://unpkg.com/mupdf@1.27.0/dist/mupdf.js');\n            window.mupdf = mupdfModule;\n            window.mupdfReady = true;\n            console.log('✓ MuPDF.js loaded successfully');\n            window.dispatchEvent(new CustomEvent('mupdf-loaded', { detail: mupdfModule }));\n          } catch (error) {\n            console.error('✗ Failed to load MuPDF.js:', error);\n            window.mupdfLoadError = error;\n            window.dispatchEvent(new CustomEvent('mupdf-error', { detail: error }));\n          }\n        `;\n\n        window.addEventListener('mupdf-loaded', (e) => {\n          resolve(e.detail);\n        }, { once: true });\n\n        window.addEventListener('mupdf-error', (e) => {\n          reject(e.detail);\n        }, { once: true });\n\n        document.head.appendChild(script);\n      });\n    </script>\n\n  <script>\n  // Global variables\n    let allFrames = [];\n    let connections = [];\n    let frameOrder = [];\n    let draggedElement = null;\n    let pendingVectorMerge = null;\n\n    // Quality settings mapping\n    const QUALITY_SETTINGS = {\n      'screen-low': { scale: 0.5, dpi: 36, label: 'Low (0.5x, 36 DPI)', group: 'screen', compression: 0.5 },\n      'screen-medium': { scale: 1.0, dpi: 72, label: 'Medium (1x, 72 DPI)', group: 'screen', compression: 0.7 },\n      'screen-high': { scale: 1.5, dpi: 108, label: 'High (1.5x, 108 DPI)', group: 'screen', compression: 0.85 },\n      'print-low': { scale: 2.0, dpi: 144, label: 'Low (2x, 144 DPI)', group: 'print', compression: 0.85 },\n      'print-medium': { scale: 3.0, dpi: 216, label: 'Medium (3x, 216 DPI)', group: 'print', compression: 0.9 },\n      'print-high': { scale: 4.0, dpi: 288, label: 'High (4x, 288 DPI)', group: 'print', compression: 0.9 },\n      'print-highest': { scale: 4.17, dpi: 300, label: 'Highest (4.17x, 300 DPI)', group: 'print', compression: 0.95 }\n    };\n\n    // Theme management\n    let currentTheme = 'dark';\n\n    function initTheme() {\n      document.body.setAttribute('data-theme', currentTheme);\n      updateThemeUI(currentTheme);\n    }\n\n    function updateThemeUI(theme) {\n      const themeSwitch = document.getElementById('theme-switch');\n      const themeLabel = document.getElementById('theme-label');\n      const themeIcon = document.querySelector('.theme-icon');\n\n      if (theme === 'dark') {\n        themeSwitch.checked = true;\n        themeLabel.textContent = 'Dark';\n        themeIcon.textContent = '🌙';\n      } else {\n        themeSwitch.checked = false;\n        themeLabel.textContent = 'Light';\n        themeIcon.textContent = '☀️';\n      }\n    }\n\n    function toggleTheme() {\n      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';\n      document.body.setAttribute('data-theme', currentTheme);\n      updateThemeUI(currentTheme);\n\n      parent.postMessage({\n        pluginMessage: {\n          type: 'save-theme',\n          theme: currentTheme\n        }\n      }, '*');\n    }\n\n    // Export type management\n    function updateExportTypeInfo() {\n      const exportType = document.querySelector('input[name=\"export-type\"]:checked').value;\n      const qualitySelect = document.getElementById('quality-select');\n\n      // Add this label element in HTML: <label class=\"quality-label\" for=\"quality-select\" id=\"quality-label\">Quality:</label>\n      const qualityLabel = document.getElementById('quality-label');\n\n      if (exportType === 'vector') {\n        qualitySelect.disabled = false;\n\n        // Update label to show it's for PNG fallbacks\n        if (qualityLabel) {\n          qualityLabel.textContent = 'Quality of embedded elements:';\n          qualityLabel.title = 'Quality for frames/layers that need rasterization';\n        }\n      } else {\n        qualitySelect.disabled = false;\n\n        if (qualityLabel) {\n          qualityLabel.textContent = 'Quality:';\n          qualityLabel.title = '';\n        }\n      }\n    }\n\n    function handleFramesUpdated(frames, frameConnections, justAdded) {\n      console.log('handleFramesUpdated called:', {\n        totalFrames: frames.length,\n        newFrames: justAdded.length,\n        frameNames: frames.map(f => f.name)\n      });\n\n      allFrames = frames;\n      connections = frameConnections;\n      frameOrder = frames.map(f => f.id);\n\n      if (frames.length === 0) {\n        document.getElementById('frame-list').style.display = 'none';\n        document.getElementById('empty-state').style.display = 'block';\n        updateExportButton();\n        return;\n      }\n\n      document.getElementById('empty-state').style.display = 'none';\n      renderFrameList(justAdded);\n      document.getElementById('frame-list').style.display = 'block';\n      updateExportButton();\n\n      const internalLinks = frameConnections.filter(c => c.type === 'internal').length;\n      const externalLinks = frameConnections.filter(c => c.type === 'external').length;\n\n      if (justAdded.length > 0) {\n        const summary = [];\n        if (internalLinks > 0) summary.push(`${internalLinks} page links`);\n        if (externalLinks > 0) summary.push(`${externalLinks} web links`);\n        const linkSummary = summary.length > 0 ? ` (${summary.join(', ')})` : '';\n        showStatus(`Added ${justAdded.length} frame${justAdded.length !== 1 ? 's' : ''}. Total: ${frames.length}${linkSummary}`, 'success');\n      } else {\n        const summary = [];\n        if (internalLinks > 0) summary.push(`${internalLinks} page`);\n        if (externalLinks > 0) summary.push(`${externalLinks} web`);\n        const linkSummary = summary.length > 0 ? ` (${summary.join(' + ')} links)` : '';\n        showStatus(`${frames.length} frame${frames.length !== 1 ? 's' : ''} in export list${linkSummary}`, 'info');\n      }\n    }\n\n    function renderFrameList(justAdded = []) {\n      const container = document.getElementById('frame-list');\n      container.innerHTML = '';\n\n      frameOrder.forEach(frameId => {\n        const frame = allFrames.find(f => f.id === frameId);\n        if (!frame) return;\n\n        const frameConnections = connections.filter(c => c.fromFrameId === frameId);\n        const internalLinks = frameConnections.filter(c => c.type === 'internal').length;\n        const externalLinks = frameConnections.filter(c => c.type === 'external').length;\n        const hasLinks = frameConnections.length > 0;\n        const isJustAdded = justAdded.includes(frameId);\n\n        const item = document.createElement('div');\n        item.className = `frame-item ${isJustAdded ? 'just-added' : ''}`;\n        item.draggable = true;\n        item.dataset.frameId = frameId;\n\n        let linkIndicator;\n        if (hasLinks) {\n          const linkParts = [];\n          if (internalLinks > 0) {\n            linkParts.push(`${internalLinks} page link${internalLinks !== 1 ? 's' : ''}`);\n          }\n          if (externalLinks > 0) {\n            linkParts.push(`${externalLinks} web link${externalLinks !== 1 ? 's' : ''}`);\n          }\n          linkIndicator = `<span class=\"connections-count\">${linkParts.join(', ')}</span>`;\n        } else {\n          linkIndicator = `<span class=\"no-links\">No links</span>`;\n        }\n\n        item.innerHTML = `\n          <input type=\"checkbox\" class=\"frame-checkbox\" checked>\n          <div class=\"frame-info\">\n            <div class=\"frame-name\">${frame.name}</div>\n            <div class=\"frame-meta\">${Math.round(frame.width)}×${Math.round(frame.height)}px • ${frame.parent}</div>\n          </div>\n          ${linkIndicator}\n          <span class=\"drag-handle\">⋮⋮</span>\n          <button class=\"remove-btn\" title=\"Remove from list\">×</button>\n        `;\n\n        const checkbox = item.querySelector('.frame-checkbox');\n        checkbox.addEventListener('change', updateExportButton);\n\n        const removeBtn = item.querySelector('.remove-btn');\n        removeBtn.addEventListener('click', (e) => {\n          e.stopPropagation();\n          removeFrameFromList(frameId);\n        });\n\n        item.addEventListener('dragstart', handleDragStart);\n        item.addEventListener('dragover', handleDragOver);\n        item.addEventListener('drop', handleDrop);\n        item.addEventListener('dragend', handleDragEnd);\n\n        container.appendChild(item);\n      });\n    }\n\n    function handleSelectionChanged(selectedFrameIds, selectedFrameNames) {\n      const selectionInfo = document.getElementById('selection-info');\n\n      if (selectedFrameIds && selectedFrameIds.length > 0) {\n        if (selectedFrameNames) {\n          selectionInfo.innerHTML = `📌 Currently selected: ${selectedFrameNames.join(', ')}`;\n          selectionInfo.style.display = 'block';\n        }\n      } else {\n        selectionInfo.style.display = 'none';\n      }\n\n      document.querySelectorAll('.frame-item').forEach(item => {\n        const frameId = item.dataset.frameId;\n        if (selectedFrameIds && selectedFrameIds.includes(frameId)) {\n          item.classList.add('selected-in-figma');\n        } else {\n          item.classList.remove('selected-in-figma');\n        }\n      });\n    }\n\n    function updateExportButton() {\n      const selectedFrames = getSelectedFrames();\n      const exportBtn = document.getElementById('export-btn');\n      exportBtn.disabled = selectedFrames.length === 0;\n      exportBtn.textContent = selectedFrames.length > 0\n        ? `Export ${selectedFrames.length} Frame${selectedFrames.length !== 1 ? 's' : ''}`\n        : 'Export PDF';\n    }\n\n    function getSelectedFrames() {\n      const checkboxes = document.querySelectorAll('.frame-checkbox:checked');\n      return Array.from(checkboxes).map(cb => cb.closest('.frame-item').dataset.frameId);\n    }\n\n    function removeFrameFromList(frameId) {\n      allFrames = allFrames.filter(f => f.id !== frameId);\n      connections = connections.filter(c => c.fromFrameId !== frameId && c.toFrameId !== frameId);\n      frameOrder = frameOrder.filter(id => id !== frameId);\n      handleFramesUpdated(allFrames, connections, []);\n    }\n\n    function clearFrameList() {\n      parent.postMessage({\n        pluginMessage: { type: 'clear-list' }\n      }, '*');\n    }\n\n    function sortFramesByName(direction) {\n      if (!direction || direction === 'none') return;\n\n      const byId = new Map(allFrames.map(frame => [frame.id, frame]));\n      const orderIndex = new Map(frameOrder.map((id, index) => [id, index]));\n\n      frameOrder.sort((a, b) => {\n        const frameA = byId.get(a);\n        const frameB = byId.get(b);\n\n        const nameA = frameA ? frameA.name : '';\n        const nameB = frameB ? frameB.name : '';\n\n        const comparison = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });\n        if (comparison !== 0) {\n          return direction === 'az' ? comparison : -comparison;\n        }\n\n        return (orderIndex.get(a) || 0) - (orderIndex.get(b) || 0);\n      });\n\n      renderFrameList();\n      showStatus(`Sorted ${frameOrder.length} frame${frameOrder.length !== 1 ? 's' : ''} (${direction === 'az' ? 'A–Z' : 'Z–A'})`, 'info');\n    }\n\n    // URL validation and normalization helper\n    function normalizeUrl(url) {\n      if (!url || typeof url !== 'string') {\n        console.warn('Invalid URL provided:', url);\n        return null;\n      }\n\n      const trimmed = url.trim();\n\n      if (/^https?:\\/\\//i.test(trimmed)) {\n        return trimmed;\n      }\n\n      if (trimmed.startsWith('//')) {\n        return 'https:' + trimmed;\n      }\n\n      if (trimmed.length > 0) {\n        console.warn(`URL missing protocol, adding https://: ${trimmed}`);\n        return 'https://' + trimmed;\n      }\n\n      return null;\n    }\n\n    // Improved link bounds calculator with minimum clickable area\n    function calculateLinkBounds(elementBounds, frameWidth, frameHeight) {\n      const MIN_CLICKABLE_SIZE = 10;\n\n      let linkX = Math.max(0, Math.min(elementBounds.x, frameWidth - MIN_CLICKABLE_SIZE));\n      let linkY = Math.max(0, Math.min(elementBounds.y, frameHeight - MIN_CLICKABLE_SIZE));\n\n      let linkWidth = Math.max(MIN_CLICKABLE_SIZE, Math.min(elementBounds.width, frameWidth - linkX));\n      let linkHeight = Math.max(MIN_CLICKABLE_SIZE, Math.min(elementBounds.height, frameHeight - linkY));\n\n      if (linkX + linkWidth > frameWidth) {\n        linkWidth = frameWidth - linkX;\n        if (linkWidth < MIN_CLICKABLE_SIZE) {\n          linkX = frameWidth - MIN_CLICKABLE_SIZE;\n          linkWidth = MIN_CLICKABLE_SIZE;\n        }\n      }\n\n      if (linkY + linkHeight > frameHeight) {\n        linkHeight = frameHeight - linkY;\n        if (linkHeight < MIN_CLICKABLE_SIZE) {\n          linkY = frameHeight - MIN_CLICKABLE_SIZE;\n          linkHeight = MIN_CLICKABLE_SIZE;\n        }\n      }\n\n      return { x: linkX, y: linkY, width: linkWidth, height: linkHeight };\n    }\n\n    // Batch handling functions\n    let pendingBatchExport = null;\n\n    function showBatchWarning(data) {\n      pendingBatchExport = data;\n\n      const modal = document.getElementById('batch-modal');\n      const warningText = document.getElementById('batch-warning-text');\n      const batchList = document.getElementById('batch-list');\n\n      warningText.innerHTML = `\n        Your selection requires <strong>${data.totalMemoryMB} MB</strong> of memory\n        (limit: ${data.limitMB} MB).<br><br>\n        The export will be split into <strong>${data.batchCount} batches</strong> to prevent crashes:\n      `;\n\n      batchList.innerHTML = data.batches.map(batch => `\n        <div class=\"batch-item\">\n          <strong>Batch ${batch.batchNumber}:</strong> ${batch.frameCount} frames\n          (${batch.frameNames.slice(0, 3).join(', ')}${batch.frameCount > 3 ? '...' : ''})\n        </div>\n      `).join('');\n\n      modal.classList.add('show');\n    }\n\n    function hideBatchWarning() {\n      document.getElementById('batch-modal').classList.remove('show');\n      pendingBatchExport = null;\n    }\n\n    async function executeBatchExport() {\n      if (!pendingBatchExport) return;\n\n      const data = pendingBatchExport.exportData;\n      const batches = pendingBatchExport.batches;\n\n      hideBatchWarning();\n\n      showStatus(`Starting batch export (${batches.length} batches)...`, 'info');\n\n      for (let i = 0; i < batches.length; i++) {\n        const batch = batches[i];\n\n        showStatus(`Exporting batch ${i + 1} of ${batches.length}...`, 'info');\n\n        parent.postMessage({\n          pluginMessage: {\n            type: 'export-batch',\n            batch: {\n              frameIds: batch.frameNames.map(name => {\n                const frame = allFrames.find(f => f.name === name);\n                return frame ? frame.id : null;\n              }).filter(Boolean)\n            },\n            batchNumber: i + 1,\n            totalBatches: batches.length,\n            quality: data.qualityString,\n            qualityScale: data.qualityScale,\n            exportType: 'raster'\n          }\n        }, '*');\n\n        await new Promise(resolve => {\n          const handler = (event) => {\n            const msg = event.data.pluginMessage;\n            if (msg.type === 'generate-pdf' && msg.batchInfo && msg.batchInfo.current === i + 1) {\n              window.removeEventListener('message', handler);\n              resolve();\n            }\n          };\n          window.addEventListener('message', handler);\n        });\n      }\n\n      showStatus(`All ${batches.length} batches exported successfully!`, 'success');\n      document.getElementById('export-btn').disabled = false;\n    }\n\n    // Export function\n    function exportImages() {\n      const selectedFrames = getSelectedFrames();\n      if (selectedFrames.length === 0) return;\n\n      const exportType = document.querySelector('input[name=\"export-type\"]:checked').value;\n      const qualitySelect = document.getElementById('quality-select');\n      const selectedQuality = qualitySelect.value;\n      const qualityScale = QUALITY_SETTINGS[selectedQuality].scale;\n\n      console.log('Exporting with type:', exportType, 'quality:', selectedQuality, 'scale:', qualityScale);\n\n      const exportTypeLabel = exportType === 'vector' ? 'smart hybrid' : selectedQuality + ' quality';\n      showStatus(`Preparing frames for export (${exportTypeLabel})...`, 'info');\n      document.getElementById('export-btn').disabled = true;\n\n      parent.postMessage({\n        pluginMessage: {\n          type: 'export-pdf',\n          frameOrder: frameOrder,\n          selectedFrames: selectedFrames,\n          quality: selectedQuality,\n          qualityScale: qualityScale,\n          exportType: exportType\n        }\n      }, '*');\n    }\n\n    function ensureStatusStructure() {\n      const status = document.getElementById('status');\n      if (!status) return null;\n\n      let title = document.getElementById('status-title');\n      let log = document.getElementById('status-log');\n\n      if (!title) {\n        title = document.createElement('div');\n        title.id = 'status-title';\n        title.className = 'status-title';\n        status.appendChild(title);\n      }\n\n      if (!log) {\n        log = document.createElement('div');\n        log.id = 'status-log';\n        log.className = 'status-log';\n        status.appendChild(log);\n      }\n\n      return { status, title, log };\n    }\n\n    function clearStatusLog() {\n      const log = document.getElementById('status-log');\n      if (log) {\n        log.innerHTML = '';\n      }\n    }\n\n    function addStatusLine(message) {\n      const log = document.getElementById('status-log');\n      if (!log) return;\n\n      const line = document.createElement('div');\n      line.className = 'status-line';\n      line.textContent = message;\n      log.appendChild(line);\n      log.scrollTop = log.scrollHeight;\n    }\n\n    function showStatus(message, type, options = {}) {\n      const { keepLog = false } = options;\n      const parts = ensureStatusStructure();\n      if (!parts) return;\n\n      parts.title.textContent = message;\n      parts.status.className = `status ${type}`;\n      parts.status.style.display = 'block';\n\n      if (!keepLog) {\n        clearStatusLog();\n      }\n    }\n\n    function hideStatus() {\n      document.getElementById('status').style.display = 'none';\n    }\n\n    // Drag and drop functions\n    function handleDragStart(e) {\n      draggedElement = e.target;\n      e.target.classList.add('dragging');\n    }\n\n    function handleDragOver(e) {\n      e.preventDefault();\n      const dragOverElement = e.target.closest('.frame-item');\n      if (dragOverElement && dragOverElement !== draggedElement) {\n        document.querySelectorAll('.frame-item').forEach(item => item.classList.remove('drag-over'));\n        dragOverElement.classList.add('drag-over');\n      }\n    }\n\n    function handleDrop(e) {\n      e.preventDefault();\n      const dropTarget = e.target.closest('.frame-item');\n\n      if (dropTarget && dropTarget !== draggedElement && draggedElement) {\n        const draggedId = draggedElement.dataset.frameId;\n        const targetId = dropTarget.dataset.frameId;\n\n        const draggedIndex = frameOrder.indexOf(draggedId);\n        const targetIndex = frameOrder.indexOf(targetId);\n\n        frameOrder.splice(draggedIndex, 1);\n        frameOrder.splice(targetIndex, 0, draggedId);\n\n        renderFrameList();\n      }\n\n      document.querySelectorAll('.frame-item').forEach(item => item.classList.remove('drag-over'));\n    }\n\n    function handleDragEnd(e) {\n      e.target.classList.remove('dragging');\n      document.querySelectorAll('.frame-item').forEach(item => item.classList.remove('drag-over'));\n      draggedElement = null;\n    }\n\n    // ============================================================================\n    // PNG FALLBACK REQUEST HANDLING\n    // ============================================================================\n\n    // Store pending PNG fallback callbacks\n    let pngFallbackCallbacks = {};\n\n    // Request PNG fallbacks from plugin for frames that failed PDF validation\n    async function requestPngFallbacks(failedFrames) {\n      return new Promise((resolve) => {\n        const results = [];\n        let pending = failedFrames.length;\n\n        if (pending === 0) {\n          resolve(results);\n          return;\n        }\n\n        // Set up timeout\n        const timeout = setTimeout(() => {\n          console.warn('PNG fallback request timed out');\n          // Resolve with whatever we have\n          while (results.length < failedFrames.length) {\n            results.push({ success: false, error: 'Timeout' });\n          }\n          resolve(results);\n        }, 30000); // 30 second timeout\n\n        // Request each PNG\n        failedFrames.forEach((frame, idx) => {\n          const callbackId = `png-fallback-${frame.id}-${Date.now()}`;\n\n          pngFallbackCallbacks[callbackId] = (result) => {\n            results.push({\n              success: result.success,\n              pngData: result.pngData,\n              width: result.width,\n              height: result.height,\n              name: result.name,\n              error: result.error,\n              index: frame.index,\n              id: frame.id,\n              frameName: frame.name\n            });\n            pending--;\n            delete pngFallbackCallbacks[callbackId];\n\n            if (pending === 0) {\n              clearTimeout(timeout);\n              resolve(results);\n            }\n          };\n\n          // Request PNG from plugin with quality scale\n                    parent.postMessage({\n                      pluginMessage: {\n                        type: 'request-png-fallback',\n                        frameId: frame.id,\n                        frameIndex: frame.index,\n                        callbackId: callbackId,\n                        qualityScale: pngFallbackScale\n                      }\n                    }, '*');\n                  });\n                });\n              }\n\n              // ============================================================================\n              // IMPROVED VECTOR PDF MERGING WITH HYBRID SUPPORT\n              // ============================================================================\n\n              // ============================================================================\n          // VECTOR PDF MERGING WITH MUPDF.JS\n          // ============================================================================\n\n          async function mergeVectorPDFsWithPdfLib(pdfBuffers, frameConnections, pngFallbackScale, summary) {\n            const { PDFDocument, PDFName, PDFString, StandardFonts } = PDFLib;\n            const pdfDoc = await PDFDocument.create();\n            const pages = [];\n            const pageIndexByFrameId = new Map();\n            let vectorCount = 0;\n            let pngCount = 0;\n\n            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);\n\n            for (const buffer of pdfBuffers) {\n              const startIndex = pages.length;\n\n              try {\n                if (buffer.isPng && buffer.pngData) {\n                  const pngBytes = toUint8Array(buffer.pngData);\n                  const pngImage = await pdfDoc.embedPng(pngBytes);\n                  const page = pdfDoc.addPage([buffer.width, buffer.height]);\n                  page.drawImage(pngImage, {\n                    x: 0,\n                    y: 0,\n                    width: buffer.width,\n                    height: buffer.height\n                  });\n                  pages.push(page);\n                  pngCount++;\n                } else if (buffer.pdfData) {\n                  const srcBytes = toUint8Array(buffer.pdfData);\n                  const srcDoc = await PDFDocument.load(srcBytes);\n                  const srcPages = await pdfDoc.copyPages(srcDoc, srcDoc.getPageIndices());\n                  srcPages.forEach((page) => {\n                    pdfDoc.addPage(page);\n                    pages.push(page);\n                  });\n                  vectorCount++;\n                } else {\n                  const page = pdfDoc.addPage([buffer.width || 800, buffer.height || 600]);\n                  page.drawText(`Export failed: ${buffer.name || 'Unknown frame'}`, {\n                    x: 40,\n                    y: (buffer.height || 600) - 80,\n                    size: 14,\n                    font: font\n                  });\n                  page.drawText('Use Rasterized mode', {\n                    x: 40,\n                    y: (buffer.height || 600) - 110,\n                    size: 12,\n                    font: font\n                  });\n                  pages.push(page);\n                }\n              } catch (pageError) {\n                console.error(`pdf-lib merge error for ${buffer.name || 'frame'}:`, pageError);\n                const page = pdfDoc.addPage([buffer.width || 800, buffer.height || 600]);\n                page.drawText(`Export failed: ${buffer.name || 'Unknown frame'}`, {\n                  x: 40,\n                  y: (buffer.height || 600) - 80,\n                  size: 14,\n                  font: font\n                });\n                pages.push(page);\n              }\n\n              pageIndexByFrameId.set(buffer.id, startIndex);\n            }\n\n            let totalLinks = 0;\n            for (const buffer of pdfBuffers) {\n              const pageIndex = pageIndexByFrameId.get(buffer.id);\n              const page = pages[pageIndex];\n\n              if (!page) continue;\n\n              const frameLinks = frameConnections.filter(conn => conn.fromFrameId === buffer.id);\n              if (frameLinks.length === 0) continue;\n\n              for (const link of frameLinks) {\n                try {\n                  const bounds = calculateLinkBounds(link.elementBounds, buffer.width, buffer.height);\n                  const yFlipped = buffer.height - bounds.y - bounds.height;\n\n                  if (link.type === 'internal') {\n                    const targetIndex = pageIndexByFrameId.get(link.toFrameId);\n                    if (typeof targetIndex === 'number' && pages[targetIndex]) {\n                      const linkAnnotation = pdfDoc.context.obj({\n                        Type: 'Annot',\n                        Subtype: 'Link',\n                        Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                        Border: [0, 0, 0],\n                        Dest: [pages[targetIndex].ref, PDFName.of('Fit')]\n                      });\n\n                      const annotations = page.node.lookup(PDFName.of('Annots'));\n                      if (annotations) {\n                        annotations.push(linkAnnotation);\n                      } else {\n                        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                      }\n                      totalLinks++;\n                    }\n                  } else if (link.type === 'external') {\n                    const normalizedUrl = normalizeUrl(link.toUrl);\n                    if (normalizedUrl) {\n                      const linkAnnotation = pdfDoc.context.obj({\n                        Type: 'Annot',\n                        Subtype: 'Link',\n                        Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                        Border: [0, 0, 0],\n                        A: {\n                          Type: 'Action',\n                          S: 'URI',\n                          URI: PDFString.of(normalizedUrl)\n                        }\n                      });\n\n                      const annotations = page.node.lookup(PDFName.of('Annots'));\n                      if (annotations) {\n                        annotations.push(linkAnnotation);\n                      } else {\n                        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                      }\n                      totalLinks++;\n                    }\n                  }\n                } catch (linkError) {\n                  console.error(`Failed to add link for ${buffer.name || 'frame'}:`, linkError);\n                }\n              }\n            }\n\n            let pdfBytes;\n            try {\n              pdfBytes = await pdfDoc.save();\n            } catch (saveError) {\n              console.error('pdf-lib save failed, retrying without object streams:', saveError);\n              pdfBytes = await pdfDoc.save({ useObjectStreams: false });\n            }\n            const blob = new Blob([pdfBytes], { type: 'application/pdf' });\n            const url = URL.createObjectURL(blob);\n            const a = document.createElement('a');\n            a.href = url;\n\n            const dateStr = new Date().toISOString().slice(0, 10);\n            const typeLabel = (vectorCount > 0 && pngCount > 0) ? 'hybrid' :\n                              (vectorCount > 0) ? 'vector' : 'png';\n            a.download = `figma-export-${typeLabel}-${dateStr}.pdf`;\n\n            document.body.appendChild(a);\n            a.click();\n            document.body.removeChild(a);\n            URL.revokeObjectURL(url);\n\n            let statusMsg = `PDF exported: ${pages.length} pages`;\n            if (vectorCount > 0 && pngCount > 0) {\n              statusMsg += ` (${vectorCount} vector, ${pngCount} PNG @ ${pngFallbackScale}x)`;\n            } else if (vectorCount > 0) {\n              statusMsg += ' (100% vector!)';\n            } else {\n              statusMsg += ` (PNG @ ${pngFallbackScale}x)`;\n            }\n\n            if (totalLinks > 0) {\n              statusMsg += ` with ${totalLinks} links`;\n            }\n\n            if (summary && summary.vectorLayers) {\n              statusMsg += `. ${summary.vectorLayers} layers kept as vector, ${summary.rasterLayers} rasterized`;\n            }\n\n            showStatus(statusMsg, 'success');\n          }\n\n          function toUint8Array(data) {\n            return data instanceof Uint8Array ? data : new Uint8Array(data);\n          }\n\n          async function mergeVectorSegmentsWithPdfLib(pdfBuffers, frameConnections, pngFallbackScale, summary) {\n            const { PDFDocument, PDFName, PDFString, StandardFonts } = PDFLib;\n            const pdfDoc = await PDFDocument.create();\n            const pages = [];\n            const pageIndexByFrameId = new Map();\n            let vectorCount = 0;\n            let pngCount = 0;\n            let vectorSegments = 0;\n            let pngSegments = 0;\n\n            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);\n\n            for (const buffer of pdfBuffers) {\n              const page = pdfDoc.addPage([buffer.width || 800, buffer.height || 600]);\n              pages.push(page);\n              pageIndexByFrameId.set(buffer.id, pages.length - 1);\n\n              let pageHasVector = false;\n              let pageHasPng = false;\n\n              try {\n                if (buffer.segments && buffer.segments.length > 0) {\n                  for (const segment of buffer.segments) {\n                    if (segment.type === 'vector' && segment.pdfData) {\n                      const segmentBytes = toUint8Array(segment.pdfData);\n                      const [embeddedPage] = await pdfDoc.embedPdf(segmentBytes, [0]);\n                      page.drawPage(embeddedPage, {\n                        x: 0,\n                        y: 0,\n                        width: buffer.width,\n                        height: buffer.height\n                      });\n                      vectorSegments++;\n                      pageHasVector = true;\n                    } else if (segment.type === 'png' && segment.pngData) {\n                      const pngBytes = toUint8Array(segment.pngData);\n                      const pngImage = await pdfDoc.embedPng(pngBytes);\n                      page.drawImage(pngImage, {\n                        x: 0,\n                        y: 0,\n                        width: buffer.width,\n                        height: buffer.height\n                      });\n                      pngSegments++;\n                      pageHasPng = true;\n                    }\n                  }\n                } else if (buffer.isPng && buffer.pngData) {\n                  const pngBytes = toUint8Array(buffer.pngData);\n                  const pngImage = await pdfDoc.embedPng(pngBytes);\n                  page.drawImage(pngImage, {\n                    x: 0,\n                    y: 0,\n                    width: buffer.width,\n                    height: buffer.height\n                  });\n                  pngSegments++;\n                  pageHasPng = true;\n                } else if (buffer.pdfData) {\n                  const srcBytes = toUint8Array(buffer.pdfData);\n                  const [embeddedPage] = await pdfDoc.embedPdf(srcBytes, [0]);\n                  page.drawPage(embeddedPage, {\n                    x: 0,\n                    y: 0,\n                    width: buffer.width,\n                    height: buffer.height\n                  });\n                  vectorSegments++;\n                  pageHasVector = true;\n                }\n              } catch (pageError) {\n                console.error(`pdf-lib layered merge error for ${buffer.name || 'frame'}:`, pageError);\n                page.drawText(`Export failed: ${buffer.name || 'Unknown frame'}`, {\n                  x: 40,\n                  y: (buffer.height || 600) - 80,\n                  size: 14,\n                  font: font\n                });\n              }\n\n              if (pageHasVector) vectorCount++;\n              if (pageHasPng) pngCount++;\n            }\n\n            let totalLinks = 0;\n            for (const buffer of pdfBuffers) {\n              const pageIndex = pageIndexByFrameId.get(buffer.id);\n              const page = pages[pageIndex];\n\n              if (!page) continue;\n\n              const frameLinks = frameConnections.filter(conn => conn.fromFrameId === buffer.id);\n              if (frameLinks.length === 0) continue;\n\n              for (const link of frameLinks) {\n                try {\n                  const bounds = calculateLinkBounds(link.elementBounds, buffer.width, buffer.height);\n                  const yFlipped = buffer.height - bounds.y - bounds.height;\n\n                  if (link.type === 'internal') {\n                    const targetIndex = pageIndexByFrameId.get(link.toFrameId);\n                    if (typeof targetIndex === 'number' && pages[targetIndex]) {\n                      const linkAnnotation = pdfDoc.context.obj({\n                        Type: 'Annot',\n                        Subtype: 'Link',\n                        Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                        Border: [0, 0, 0],\n                        Dest: [pages[targetIndex].ref, PDFName.of('Fit')]\n                      });\n\n                      const annotations = page.node.lookup(PDFName.of('Annots'));\n                      if (annotations) {\n                        annotations.push(linkAnnotation);\n                      } else {\n                        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                      }\n                      totalLinks++;\n                    }\n                  } else if (link.type === 'external') {\n                    const normalizedUrl = normalizeUrl(link.toUrl);\n                    if (normalizedUrl) {\n                      const linkAnnotation = pdfDoc.context.obj({\n                        Type: 'Annot',\n                        Subtype: 'Link',\n                        Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                        Border: [0, 0, 0],\n                        A: {\n                          Type: 'Action',\n                          S: 'URI',\n                          URI: PDFString.of(normalizedUrl)\n                        }\n                      });\n\n                      const annotations = page.node.lookup(PDFName.of('Annots'));\n                      if (annotations) {\n                        annotations.push(linkAnnotation);\n                      } else {\n                        page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                      }\n                      totalLinks++;\n                    }\n                  }\n                } catch (linkError) {\n                  console.error(`Failed to add link for ${buffer.name || 'frame'}:`, linkError);\n                }\n              }\n            }\n\n            let pdfBytes;\n            try {\n              pdfBytes = await pdfDoc.save();\n            } catch (saveError) {\n              console.error('pdf-lib save failed, retrying without object streams:', saveError);\n              pdfBytes = await pdfDoc.save({ useObjectStreams: false });\n            }\n            const blob = new Blob([pdfBytes], { type: 'application/pdf' });\n            const url = URL.createObjectURL(blob);\n            const a = document.createElement('a');\n            a.href = url;\n\n            const dateStr = new Date().toISOString().slice(0, 10);\n            const typeLabel = (vectorCount > 0 && pngCount > 0) ? 'hybrid' :\n                              (vectorCount > 0) ? 'vector' : 'png';\n            a.download = `figma-export-${typeLabel}-${dateStr}.pdf`;\n\n            document.body.appendChild(a);\n            a.click();\n            document.body.removeChild(a);\n            URL.revokeObjectURL(url);\n\n            let statusMsg = `PDF exported: ${pages.length} pages`;\n            if (vectorCount > 0 && pngCount > 0) {\n              statusMsg += ` (${vectorCount} pages vector, ${pngCount} pages raster)`;\n            } else if (vectorCount > 0) {\n              statusMsg += ' (100% vector!)';\n            } else {\n              statusMsg += ` (PNG @ ${pngFallbackScale}x)`;\n            }\n\n            if (vectorSegments > 0 || pngSegments > 0) {\n              statusMsg += `, segments: ${vectorSegments} vector + ${pngSegments} raster`;\n            }\n\n            if (totalLinks > 0) {\n              statusMsg += ` with ${totalLinks} links`;\n            }\n\n            if (summary && summary.vectorLayers) {\n              statusMsg += `. ${summary.vectorLayers} layers kept as vector, ${summary.rasterLayers} rasterized`;\n            }\n\n            showStatus(statusMsg, 'success');\n          }\n\n          async function mergeVectorPDFs(pdfBuffers, frameConnections, order, failedFrames, summary) {\n            failedFrames = failedFrames || [];\n            summary = summary || null;\n\n            const pngFallbackScale = summary && summary.quality ? summary.quality : 1.5;\n\n            const hasSegments = pdfBuffers.some(buffer => buffer.segments && buffer.segments.length > 0);\n            if (hasSegments) {\n              showStatus('Compositing layered vector/raster segments...', 'info');\n              try {\n                await mergeVectorSegmentsWithPdfLib(pdfBuffers, frameConnections, pngFallbackScale, summary);\n              } catch (error) {\n                console.error('Layered pdf-lib merge error:', error);\n                showStatus('Failed: ' + error.message + '. Try Rasterized export.', 'error');\n              } finally {\n                document.getElementById('export-btn').disabled = false;\n              }\n              return;\n            }\n\n            try {\n              // Wait for MuPDF to finish loading\n              if (!window.mupdfReady) {\n                console.log('⏳ Waiting for MuPDF.js to load...');\n                showStatus('Loading MuPDF.js library...', 'info');\n\n                try {\n                  await window.mupdfLoadPromise;\n                } catch (loadError) {\n                  throw new Error('Failed to load MuPDF.js: ' + loadError.message + '. Try refreshing the page or use Rasterized mode.');\n                }\n              }\n\n              // Check if load was successful\n              if (!window.mupdf || window.mupdfLoadError) {\n                throw new Error('MuPDF.js failed to load. Try refreshing the page or use Rasterized mode.');\n              }\n\n              const mupdf = window.mupdf.default || window.mupdf;\n\n              function toArrayBuffer(bytes) {\n                const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);\n                return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);\n              }\n\n              function ensurePdfDoc(doc, label) {\n                if (!doc || typeof doc.countPages !== 'function') {\n                  throw new Error(`MuPDF ${label} doc missing countPages`);\n                }\n                return doc;\n              }\n\n              function ensureMergedDoc(doc, label) {\n                if (!doc || typeof doc.newPage !== 'function' || typeof doc.graftPage !== 'function') {\n                  const methods = doc ? Object.keys(Object.getPrototypeOf(doc) || {}) : [];\n                  throw new Error(`MuPDF ${label} doc missing newPage/graftPage. Methods: ${methods.join(', ')}`);\n                }\n                return doc;\n              }\n\n              function createPdfDocument() {\n                const candidates = [];\n                if (mupdf.PDFDocument && typeof mupdf.PDFDocument.create === 'function') {\n                  candidates.push(() => mupdf.PDFDocument.create());\n                }\n                if (typeof mupdf.PDFDocument === 'function') {\n                  candidates.push(() => new mupdf.PDFDocument());\n                }\n                if (mupdf.Document && typeof mupdf.Document.createDocument === 'function') {\n                  candidates.push(() => mupdf.Document.createDocument('application/pdf'));\n                }\n\n                for (const create of candidates) {\n                  try {\n                    return ensureMergedDoc(create(), 'create');\n                  } catch (error) {\n                    console.warn('MuPDF create candidate failed:', error.message);\n                  }\n                }\n\n                throw new Error('MuPDF PDF document creation API not found');\n              }\n\n              function openPdfDocument(pdfBytes) {\n                const bytes = toUint8Array(pdfBytes);\n                const buffer = toArrayBuffer(bytes);\n\n                const candidates = [];\n                if (mupdf.PDFDocument && typeof mupdf.PDFDocument.openDocument === 'function') {\n                  candidates.push(() => mupdf.PDFDocument.openDocument(buffer));\n                  candidates.push(() => mupdf.PDFDocument.openDocument(bytes));\n                }\n                if (mupdf.Document && typeof mupdf.Document.openDocument === 'function') {\n                  candidates.push(() => mupdf.Document.openDocument(buffer, 'application/pdf'));\n                  candidates.push(() => mupdf.Document.openDocument(bytes, 'application/pdf'));\n                }\n                if (typeof mupdf.Document === 'function') {\n                  candidates.push(() => new mupdf.Document(buffer, 'application/pdf'));\n                  candidates.push(() => new mupdf.Document(bytes, 'application/pdf'));\n                }\n\n                for (const open of candidates) {\n                  try {\n                    return ensurePdfDoc(open(), 'open');\n                  } catch (error) {\n                    console.warn('MuPDF open candidate failed:', error.message);\n                  }\n                }\n\n                throw new Error('MuPDF open PDF API not found');\n              }\n\n              function createPngImage(pngBytes) {\n                const bytes = toUint8Array(pngBytes);\n                const buffer = toArrayBuffer(bytes);\n                const candidates = [];\n                if (mupdf.Image && typeof mupdf.Image.fromPNG === 'function') {\n                  candidates.push(() => mupdf.Image.fromPNG(buffer));\n                  candidates.push(() => mupdf.Image.fromPNG(bytes));\n                }\n                if (typeof mupdf.Image === 'function') {\n                  candidates.push(() => new mupdf.Image(buffer));\n                  candidates.push(() => new mupdf.Image(bytes));\n                }\n                for (const create of candidates) {\n                  try {\n                    return create();\n                  } catch (error) {\n                    console.warn('MuPDF image candidate failed:', error.message);\n                  }\n                }\n                throw new Error('MuPDF image API not found');\n              }\n\n              function loadPageSafe(doc, index) {\n                if (!doc || typeof doc.loadPage !== 'function') {\n                  throw new Error('MuPDF doc missing loadPage');\n                }\n                try {\n                  return doc.loadPage(index);\n                } catch (error) {\n                  return doc.loadPage(index + 1);\n                }\n              }\n\n              console.log('═══════════════════════════════════════════════════');\n              console.log('MUPDF VECTOR PDF MERGE');\n              console.log('  Total pages:', pdfBuffers.length);\n              console.log('═══════════════════════════════════════════════════');\n\n              showStatus('Merging vector PDFs with MuPDF...', 'info');\n\n              // Create a new blank PDF document\n              const mergedDoc = createPdfDocument();\n\n              let vectorCount = 0;\n              let pngCount = 0;\n              let pageIndex = 0;\n\n              // Process each buffer\n              for (let i = 0; i < pdfBuffers.length; i++) {\n                const buffer = pdfBuffers[i];\n\n                console.log(`[${i + 1}/${pdfBuffers.length}] Processing \"${buffer.name}\"`);\n\n                try {\n                  if (buffer.isPng && buffer.pngData) {\n                    // PNG page - embed as image\n                    console.log('  → Embedding PNG');\n\n                    const pngBytes = toUint8Array(buffer.pngData);\n                    const pngImage = createPngImage(pngBytes);\n\n                    // Create a new page with the frame dimensions\n                    const page = mergedDoc.newPage(pageIndex, buffer.width, buffer.height);\n\n                    // Insert the image at full size\n                    page.insertImage(pngImage, [0, 0, buffer.width, buffer.height]);\n\n                    pngCount++;\n                    pageIndex++;\n                    console.log('  ✓ PNG embedded');\n\n                  } else if (buffer.pdfData) {\n                    // Vector PDF - merge pages\n                    console.log('  → Merging vector PDF');\n\n                    const pdfBytes = toUint8Array(buffer.pdfData);\n                    const srcDoc = openPdfDocument(pdfBytes);\n\n                    // Copy all pages from source document\n                    const pageCount = srcDoc.countPages();\n                    for (let p = 0; p < pageCount; p++) {\n                      mergedDoc.graftPage(pageIndex, srcDoc, p);\n                      pageIndex++;\n                    }\n\n                    vectorCount++;\n                    console.log(`  ✓ Merged ${pageCount} vector page(s)`);\n\n                  } else {\n                    console.error('  ✗ No valid data');\n                  }\n\n                } catch (pageError) {\n                  console.error(`  ✗ Error processing page: ${pageError.message}`);\n\n                  // Add error placeholder page\n                  try {\n                    const page = mergedDoc.newPage(pageIndex, buffer.width || 800, buffer.height || 600);\n                    const font = new mupdf.Font(\"Helvetica\");\n\n                    page.insertText(\"Export failed: \" + buffer.name, font, 14, [40, buffer.height - 100]);\n                    page.insertText(\"Use Rasterized mode\", font, 12, [40, buffer.height - 130]);\n                  } catch (placeholderError) {\n                    console.error('  ✗ Could not create placeholder:', placeholderError.message);\n                  }\n\n                  pageIndex++;\n                }\n              }\n\n              console.log('\\n--- Adding Links ---');\n\n              // Add links to pages\n              let totalLinks = 0;\n              const pages = [];\n\n              // Get all pages\n              for (let i = 0; i < pageIndex; i++) {\n                try {\n                  pages.push(loadPageSafe(mergedDoc, i));\n                } catch (e) {\n                  console.error(`Could not load page ${i}:`, e);\n                  pages.push(null);\n                }\n              }\n\n              // Add links\n              for (let i = 0; i < pdfBuffers.length; i++) {\n                const buffer = pdfBuffers[i];\n                const page = pages[i];\n\n                if (!page) continue;\n\n                const frameLinks = frameConnections.filter(c => c.fromFrameId === buffer.id);\n\n                for (const link of frameLinks) {\n                  try {\n                    const bounds = calculateLinkBounds(link.elementBounds, buffer.width, buffer.height);\n\n                    // MuPDF uses bottom-left origin, need to flip Y\n                    const rect = [\n                      bounds.x,\n                      buffer.height - bounds.y - bounds.height,\n                      bounds.x + bounds.width,\n                      buffer.height - bounds.y\n                    ];\n\n                    if (link.type === 'internal') {\n                      const targetIdx = pdfBuffers.findIndex(b => b.id === link.toFrameId);\n                      if (targetIdx >= 0) {\n                        page.insertLink(rect, `#page=${targetIdx + 1}`);\n                        totalLinks++;\n                      }\n                    } else if (link.type === 'external') {\n                      const url = normalizeUrl(link.toUrl);\n                      if (url) {\n                        page.insertLink(rect, url);\n                        totalLinks++;\n                      }\n                    }\n\n                  } catch (linkError) {\n                    console.error(`  ✗ Link error: ${linkError.message}`);\n                  }\n                }\n              }\n\n              console.log(`✓ Added ${totalLinks} links`);\n\n              if (pageIndex === 0) {\n                throw new Error('No pages were added to the merged PDF');\n              }\n\n              // Save the merged PDF\n              console.log('\\n--- Saving PDF ---');\n              showStatus('Saving merged PDF...', 'info');\n\n              const pdfBytes = mergedDoc.saveToBuffer(\"compress\").asUint8Array();\n\n              // Download\n              const blob = new Blob([pdfBytes], { type: 'application/pdf' });\n              const url = URL.createObjectURL(blob);\n              const a = document.createElement('a');\n              a.href = url;\n\n              const dateStr = new Date().toISOString().slice(0, 10);\n              const typeLabel = (vectorCount > 0 && pngCount > 0) ? 'hybrid' :\n                                (vectorCount > 0) ? 'vector' : 'png';\n              a.download = `figma-export-${typeLabel}-${dateStr}.pdf`;\n\n              document.body.appendChild(a);\n              a.click();\n              document.body.removeChild(a);\n              URL.revokeObjectURL(url);\n\n              // Success message\n              console.log('\\n═══════════════════════════════════════════════════');\n              console.log('COMPLETE:', pageIndex, 'pages');\n              console.log('  Vector PDFs:', vectorCount);\n              console.log('  PNG pages:', pngCount);\n              console.log('  Links:', totalLinks);\n              console.log('═══════════════════════════════════════════════════');\n\n              let statusMsg = `PDF exported: ${pageIndex} pages`;\n              if (vectorCount > 0 && pngCount > 0) {\n                statusMsg += ` (${vectorCount} vector, ${pngCount} PNG @ ${pngFallbackScale}x)`;\n              } else if (vectorCount > 0) {\n                statusMsg += ' (100% vector!)';\n              } else {\n                statusMsg += ` (PNG @ ${pngFallbackScale}x)`;\n              }\n\n              if (totalLinks > 0) {\n                statusMsg += ` with ${totalLinks} links`;\n              }\n\n              // Add layer stats if available\n              if (summary && summary.vectorLayers) {\n                statusMsg += `. ${summary.vectorLayers} layers kept as vector, ${summary.rasterLayers} rasterized`;\n              }\n\n              showStatus(statusMsg, 'success');\n\n            } catch (error) {\n              console.error('MuPDF merge error:', error);\n              console.warn('Falling back to pdf-lib merge');\n              try {\n                await mergeVectorPDFsWithPdfLib(pdfBuffers, frameConnections, pngFallbackScale, summary);\n                return;\n              } catch (fallbackError) {\n                console.error('pdf-lib merge error:', fallbackError);\n                showStatus('Failed: ' + fallbackError.message + '. Try Rasterized export.', 'error');\n              }\n            } finally {\n              document.getElementById('export-btn').disabled = false;\n            }\n          }\n          \n    async function downloadImages(frames, frameConnections, order, qualityFromMessage) {\n      try {\n        const quality = qualityFromMessage || 'high';\n        const qualityLabel = QUALITY_SETTINGS[quality]?.label || 'High (1.5x)';\n        showStatus(`Generating PDF with internal links (${qualityLabel})...`, 'info');\n\n        const totalSize = frames.reduce((sum, f) => sum + f.imageData.length, 0);\n        const maxSizeForJsPDF = 50 * 1024 * 1024;\n\n        console.log(`Total image data size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);\n\n        if (totalSize > maxSizeForJsPDF) {\n          console.log('Using pdf-lib for large file export');\n          await generatePDFWithPdfLib(frames, frameConnections, quality);\n        } else {\n          console.log('Using jsPDF for standard export');\n          await generatePDFWithJsPDFOptimized(frames, frameConnections, quality);\n        }\n\n      } catch (error) {\n        console.error('PDF generation error:', error);\n        showStatus('Failed to generate PDF: ' + error.message, 'error');\n        exportImagesAsFallback(frames, frameConnections);\n      } finally {\n        document.getElementById('export-btn').disabled = false;\n      }\n    }\n\n    async function generatePDFWithJsPDFOptimized(frames, frameConnections, quality) {\n      const { jsPDF } = window.jspdf;\n\n      const firstFrame = frames[0];\n      const orientation = firstFrame.width > firstFrame.height ? 'landscape' : 'portrait';\n\n      const pdf = new jsPDF({\n        orientation: orientation,\n        unit: 'pt',\n        format: [firstFrame.width, firstFrame.height]\n      });\n\n      pdf.deletePage(1);\n\n      const batchSize = 5;\n\n      for (let batchStart = 0; batchStart < frames.length; batchStart += batchSize) {\n        const batchEnd = Math.min(batchStart + batchSize, frames.length);\n        const batch = frames.slice(batchStart, batchEnd);\n\n        for (let i = 0; i < batch.length; i++) {\n          const frame = batch[i];\n          const pageIndex = batchStart + i + 1;\n\n          console.log(`Processing page ${pageIndex}/${frames.length}: \"${frame.name}\"`);\n\n          const frameOrientation = frame.width > frame.height ? 'landscape' : 'portrait';\n\n          pdf.addPage([frame.width, frame.height], frameOrientation);\n          pdf.setPage(pageIndex);\n\n          try {\n            const imageData = await compressImageIfNeeded(frame.imageData, quality);\n\n            const blob = new Blob([imageData], { type: 'image/png' });\n            const imageUrl = URL.createObjectURL(blob);\n\n            await new Promise((resolve, reject) => {\n              const img = new Image();\n              img.onload = function() {\n                try {\n                  pdf.addImage(img, 'PNG', 0, 0, frame.width, frame.height, undefined, 'FAST');\n                  URL.revokeObjectURL(imageUrl);\n                  resolve();\n                } catch (err) {\n                  URL.revokeObjectURL(imageUrl);\n                  reject(err);\n                }\n              };\n              img.onerror = function(err) {\n                URL.revokeObjectURL(imageUrl);\n                reject(new Error(`Failed to load image for frame: ${frame.name}`));\n              };\n              img.src = imageUrl;\n            });\n          } catch (error) {\n            console.error(`Error adding frame ${frame.name}:`, error);\n          }\n        }\n      }\n\n      // Add links\n      for (let i = 0; i < frames.length; i++) {\n        const frame = frames[i];\n        const pageIndex = i + 1;\n        const frameLinks = frameConnections.filter(conn => conn.fromFrameId === frame.id);\n\n        if (frameLinks.length > 0) {\n          pdf.setPage(pageIndex);\n\n          frameLinks.forEach(link => {\n            try {\n              const bounds = calculateLinkBounds(link.elementBounds, frame.width, frame.height);\n\n              if (link.type === 'internal') {\n                const targetFrameIndex = frames.findIndex(f => f.id === link.toFrameId);\n                if (targetFrameIndex >= 0) {\n                  pdf.link(bounds.x, bounds.y, bounds.width, bounds.height, {\n                    pageNumber: targetFrameIndex + 1\n                  });\n                }\n              } else if (link.type === 'external') {\n                const normalizedUrl = normalizeUrl(link.toUrl);\n                if (normalizedUrl) {\n                  pdf.link(bounds.x, bounds.y, bounds.width, bounds.height, {\n                    url: normalizedUrl\n                  });\n                }\n              }\n            } catch (linkError) {\n              console.error(`Failed to add link on page ${pageIndex}:`, linkError);\n            }\n          });\n        }\n      }\n\n      const filename = `figma-export-${new Date().toISOString().slice(0, 10)}_${quality}.pdf`;\n      pdf.save(filename);\n\n      showStatus(`PDF exported successfully as ${filename}!`, 'success');\n    }\n\n    async function generatePDFWithPdfLib(frames, frameConnections, quality) {\n      const { PDFDocument, PDFName } = PDFLib;\n\n      try {\n        const pdfDoc = await PDFDocument.create();\n\n        for (let i = 0; i < frames.length; i++) {\n          const frame = frames[i];\n          console.log(`Processing frame ${i + 1}/${frames.length}: \"${frame.name}\"`);\n\n          try {\n            const imageData = await compressImageIfNeeded(frame.imageData, quality);\n            const pngImage = await pdfDoc.embedPng(imageData);\n            const page = pdfDoc.addPage([frame.width, frame.height]);\n\n            page.drawImage(pngImage, {\n              x: 0,\n              y: 0,\n              width: frame.width,\n              height: frame.height,\n            });\n          } catch (frameError) {\n            console.error(`Error processing frame ${frame.name}:`, frameError);\n            pdfDoc.addPage([frame.width, frame.height]);\n          }\n        }\n\n        // Add links\n        const pages = pdfDoc.getPages();\n\n        for (let i = 0; i < frames.length; i++) {\n          const frame = frames[i];\n          const page = pages[i];\n          const frameLinks = frameConnections.filter(conn => conn.fromFrameId === frame.id);\n\n          if (frameLinks.length === 0) continue;\n\n          for (const link of frameLinks) {\n            try {\n              const bounds = calculateLinkBounds(link.elementBounds, frame.width, frame.height);\n              const yFlipped = frame.height - bounds.y - bounds.height;\n\n              if (link.type === 'internal') {\n                const targetIndex = frames.findIndex(f => f.id === link.toFrameId);\n                if (targetIndex >= 0) {\n                  const linkAnnotation = pdfDoc.context.obj({\n                    Type: 'Annot',\n                    Subtype: 'Link',\n                    Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                    Border: [0, 0, 0],\n                    Dest: [pages[targetIndex].ref, PDFName.of('Fit')],\n                  });\n\n                  const annotations = page.node.lookup(PDFName.of('Annots'));\n                  if (annotations) {\n                    annotations.push(linkAnnotation);\n                  } else {\n                    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                  }\n                }\n              } else if (link.type === 'external') {\n                const normalizedUrl = normalizeUrl(link.toUrl);\n                if (normalizedUrl) {\n                  const linkAnnotation = pdfDoc.context.obj({\n                    Type: 'Annot',\n                    Subtype: 'Link',\n                    Rect: [bounds.x, yFlipped, bounds.x + bounds.width, yFlipped + bounds.height],\n                    Border: [0, 0, 0],\n                    A: {\n                      Type: 'Action',\n                      S: 'URI',\n                      URI: PDFLib.PDFString.of(normalizedUrl),\n                    },\n                  });\n\n                  const annotations = page.node.lookup(PDFName.of('Annots'));\n                  if (annotations) {\n                    annotations.push(linkAnnotation);\n                  } else {\n                    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([linkAnnotation]));\n                  }\n                }\n              }\n            } catch (linkError) {\n              console.error(`Failed to add link on page ${i + 1}:`, linkError);\n            }\n          }\n        }\n\n        let pdfBytes;\n        try {\n          pdfBytes = await pdfDoc.save();\n        } catch (saveError) {\n          console.error('pdf-lib save failed, retrying without object streams:', saveError);\n          pdfBytes = await pdfDoc.save({ useObjectStreams: false });\n        }\n        const blob = new Blob([pdfBytes], { type: 'application/pdf' });\n        const url = URL.createObjectURL(blob);\n        const a = document.createElement('a');\n        a.href = url;\n        a.download = `figma-export-${new Date().toISOString().slice(0, 10)}_${quality}.pdf`;\n        document.body.appendChild(a);\n        a.click();\n        document.body.removeChild(a);\n        URL.revokeObjectURL(url);\n\n        showStatus('PDF exported successfully!', 'success');\n\n      } catch (error) {\n        console.error('pdf-lib error:', error);\n        throw error;\n      }\n    }\n\n    async function compressImageIfNeeded(imageData, quality) {\n      const maxSize = 10 * 1024 * 1024;\n\n      if (imageData.length <= maxSize) {\n        return imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);\n      }\n\n      console.log(`Compressing large image (${(imageData.length / 1024 / 1024).toFixed(2)}MB)`);\n\n      try {\n        const bytes = imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);\n        const blob = new Blob([bytes], { type: 'image/png' });\n        const imageUrl = URL.createObjectURL(blob);\n\n        return new Promise((resolve) => {\n          const img = new Image();\n          img.onload = function() {\n            const canvas = document.createElement('canvas');\n            const ctx = canvas.getContext('2d');\n\n            const scale = QUALITY_SETTINGS[quality]?.compression || 0.7;\n            canvas.width = img.width * scale;\n            canvas.height = img.height * scale;\n\n            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);\n\n            canvas.toBlob((blob) => {\n              blob.arrayBuffer().then(buffer => {\n                URL.revokeObjectURL(imageUrl);\n                resolve(new Uint8Array(buffer));\n              });\n            }, 'image/png', 0.8);\n          };\n          img.onerror = function() {\n            URL.revokeObjectURL(imageUrl);\n            resolve(imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData));\n          };\n          img.src = imageUrl;\n        });\n      } catch (error) {\n        console.error('Compression failed:', error);\n        return imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);\n      }\n    }\n\n    function exportImagesAsFallback(frames, frameConnections) {\n      try {\n        showStatus('PDF generation failed, exporting as images...', 'info');\n\n        let connectionInfo = \"PDF Link Mapping:\\n\\n\";\n\n        frames.forEach((frame, index) => {\n          connectionInfo += `Page ${index + 1}: ${frame.name}\\n`;\n          const frameLinks = frameConnections.filter(conn => conn.fromFrameId === frame.id);\n\n          frameLinks.forEach(link => {\n            if (link.type === 'internal') {\n              const targetFrame = frames.find(f => f.id === link.toFrameId);\n              const targetIndex = frames.findIndex(f => f.id === link.toFrameId);\n              if (targetFrame && targetIndex >= 0) {\n                connectionInfo += `  - Link from \"${link.elementName}\" to Page ${targetIndex + 1} (${targetFrame.name})\\n`;\n              }\n            } else if (link.type === 'external') {\n              connectionInfo += `  - External link from \"${link.elementName}\" to ${link.toUrl}\\n`;\n            }\n          });\n          connectionInfo += \"\\n\";\n        });\n\n        const blob = new Blob([connectionInfo], { type: 'text/plain' });\n        const url = URL.createObjectURL(blob);\n        const a = document.createElement('a');\n        a.href = url;\n        a.download = `figma-links-${new Date().toISOString().slice(0, 10)}.txt`;\n        document.body.appendChild(a);\n        a.click();\n        document.body.removeChild(a);\n        URL.revokeObjectURL(url);\n\n        frames.forEach((frame, index) => {\n          const imageData = frame.imageData instanceof Uint8Array ? frame.imageData : new Uint8Array(frame.imageData);\n          const blob = new Blob([imageData], { type: 'image/png' });\n          const url = URL.createObjectURL(blob);\n          const a = document.createElement('a');\n          a.href = url;\n          a.download = `page-${index + 1}-${frame.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`;\n          document.body.appendChild(a);\n          a.click();\n          document.body.removeChild(a);\n          URL.revokeObjectURL(url);\n        });\n\n        showStatus(`Exported ${frames.length} images and connection info as fallback`, 'success');\n\n      } catch (error) {\n        showStatus('Failed to export: ' + error.message, 'error');\n      }\n    }\n\n    function beginVectorMerge(msg) {\n      pendingVectorMerge = {\n        buffersById: new Map(),\n        connections: msg.connections || [],\n        frameOrder: msg.frameOrder || [],\n        failedFrames: msg.failedFrames || [],\n        summary: msg.summary || {},\n        totalChunks: msg.totalChunks || 0,\n        receivedChunks: 0\n      };\n\n      const totalChunks = pendingVectorMerge.totalChunks || 0;\n      const statusMsg = totalChunks > 0\n        ? `Receiving export data... (0/${totalChunks})`\n        : 'Receiving export data...';\n      showStatus(statusMsg, 'info', { keepLog: true });\n    }\n\n    function addVectorMergeChunk(msg) {\n      if (!pendingVectorMerge) {\n        return;\n      }\n\n      const buffers = msg.pdfBuffers || [];\n      for (const buffer of buffers) {\n        if (buffer && buffer.id) {\n          pendingVectorMerge.buffersById.set(buffer.id, buffer);\n        }\n      }\n\n      pendingVectorMerge.receivedChunks += 1;\n      const totalChunks = pendingVectorMerge.totalChunks || 0;\n      if (totalChunks > 0) {\n        showStatus(`Receiving export data... (${pendingVectorMerge.receivedChunks}/${totalChunks})`, 'info', { keepLog: true });\n      }\n    }\n\n    function completeVectorMerge() {\n      if (!pendingVectorMerge) {\n        return;\n      }\n\n      const { buffersById, connections, frameOrder, failedFrames, summary } = pendingVectorMerge;\n      const orderedBuffers = [];\n\n      if (frameOrder && frameOrder.length > 0) {\n        for (const id of frameOrder) {\n          const buffer = buffersById.get(id);\n          if (buffer) {\n            orderedBuffers.push(buffer);\n          }\n        }\n      } else {\n        orderedBuffers.push(...buffersById.values());\n      }\n\n      pendingVectorMerge = null;\n      mergeVectorPDFs(orderedBuffers, connections, frameOrder, failedFrames, summary);\n    }\n\n    // ============================================================================\n    // INITIALIZATION\n    // ============================================================================\n\n    document.addEventListener('DOMContentLoaded', function() {\n      initTheme();\n      updateExportTypeInfo();\n\n      // Check MuPDF loading status\n      window.mupdfLoadPromise.then(() => {\n        console.log('✓ MuPDF.js ready for vector exports');\n      }).catch((error) => {\n        console.error('✗ MuPDF.js failed to load:', error);\n        showStatus('Warning: Vector mode unavailable. Use Rasterized mode.', 'warning');\n      });\n\n      document.getElementById('theme-switch').addEventListener('change', toggleTheme);\n      document.getElementById('export-btn').addEventListener('click', exportImages);\n      document.getElementById('clear-list-btn').addEventListener('click', clearFrameList);\n      document.getElementById('sort-select').addEventListener('change', (event) => {\n        sortFramesByName(event.target.value);\n        event.target.value = 'none';\n      });\n      document.getElementById('batch-cancel-btn').addEventListener('click', hideBatchWarning);\n      document.getElementById('batch-export-btn').addEventListener('click', executeBatchExport);\n\n      document.querySelectorAll('input[name=\"export-type\"]').forEach(radio => {\n        radio.addEventListener('change', updateExportTypeInfo);\n      });\n\n      document.getElementById('empty-state').style.display = 'block';\n      document.getElementById('frame-list').style.display = 'none';\n    });\n\n    // Listen for messages from plugin code\n    window.onmessage = (event) => {\n      const msg = event.data.pluginMessage;\n      console.log('Received message:', msg.type);\n\n      if (msg.type === 'plugin-ready') {\n        showStatus(msg.message, 'info');\n      } else if (msg.type === 'vector-export-progress') {\n        const phaseInfo = msg.phase ? ` [${msg.phase}]` : '';\n        showStatus('Export in progress...', 'info', { keepLog: true });\n        addStatusLine(`${msg.message}${phaseInfo}`);\n      } else if (msg.type === 'merge-vector-pdfs-start') {\n        beginVectorMerge(msg);\n      } else if (msg.type === 'merge-vector-pdfs-chunk') {\n        addVectorMergeChunk(msg);\n      } else if (msg.type === 'merge-vector-pdfs-end') {\n        completeVectorMerge();\n      } else if (msg.type === 'warning') {\n        showStatus(msg.message, 'warning');\n      } else if (msg.type === 'batch-warning') {\n        showBatchWarning(msg);\n      } else if (msg.type === 'restore-theme') {\n        if (msg.theme) {\n          currentTheme = msg.theme;\n          document.body.setAttribute('data-theme', currentTheme);\n          updateThemeUI(currentTheme);\n        }\n      } else if (msg.type === 'frames-updated') {\n        handleFramesUpdated(msg.frames, msg.connections, msg.justAdded);\n      } else if (msg.type === 'generate-pdf') {\n        downloadImages(msg.frames, msg.connections, msg.frameOrder, msg.quality || 'high');\n      } else if (msg.type === 'merge-vector-pdfs') {\n        mergeVectorPDFs(msg.pdfBuffers, msg.connections, msg.frameOrder, msg.failedFrames, msg.summary);\n      } else if (msg.type === 'selection-changed') {\n        handleSelectionChanged(msg.selectedFrameIds, msg.selectedFrameNames);\n      } else if (msg.type === 'png-fallback-result') {\n        // Handle PNG fallback response from plugin\n        console.log('Received PNG fallback result:', msg.frameId, msg.success);\n\n        // Find and call the callback\n        const callbackKey = Object.keys(pngFallbackCallbacks).find(k => k.includes(msg.frameId));\n        if (callbackKey && pngFallbackCallbacks[callbackKey]) {\n          pngFallbackCallbacks[callbackKey]({\n            success: msg.success,\n            pngData: msg.pngData,\n            width: msg.width,\n            height: msg.height,\n            name: msg.name,\n            error: msg.error\n          });\n        }\n      } else if (msg.type === 'error') {\n        showStatus(msg.message, 'error');\n        document.getElementById('export-btn').disabled = false;\n      }\n    };\n  </script>\n</body>\n</html>\n";// Main plugin code that runs in Figma's sandbox
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
