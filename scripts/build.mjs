import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfLibraryLicenses = [
  ['pdf-lib', 'pdf-lib/LICENSE.md', 'pdf-lib-MIT.txt'],
  ['@pdf-lib/standard-fonts', '@pdf-lib/standard-fonts/LICENSE.md', 'pdf-lib-standard-fonts-MIT.txt'],
  ['@pdf-lib/upng', '@pdf-lib/upng/LICENSE', 'pdf-lib-upng-MIT.txt'],
  ['pako', 'pako/LICENSE', 'pako-MIT.txt'],
  ['tslib', 'tslib/LICENSE.txt', 'tslib-0BSD.txt']
];
// tslib exposes its entry point but intentionally does not export license files.
const resolvePdfLicense = location => location === 'tslib/LICENSE.txt'
  ? path.join(path.dirname(require.resolve('tslib')), 'LICENSE.txt') : require.resolve(location);

export async function buildPdfLibrary() {
  const packageInfo = require('pdf-lib/package.json');
  const asyncPath = require.resolve('pdf-lib/cjs/utils/async.js');
  const expectedAsyncHash = 'd690606a1e505449ce947a83bd33f3d57d0c38c1f13f757329f1e5012ff706a6';
  if (packageInfo.version !== '1.17.1' || createHash('sha256').update(readFileSync(asyncPath)).digest('hex') !== expectedAsyncHash) {
    throw new Error('The pinned pdf-lib cooperative-wait adapter needs review for this dependency version.');
  }
  let overrides = 0;
  const license = pdfLibraryLicenses.map(([name, location]) => `/*! ${name}\n${readFileSync(resolvePdfLicense(location), 'utf8').replace(/\r\n/g, '\n')}*/`).join('\n');
  const result = await build({
    stdin: { contents: 'globalThis.PDFLib = require("pdf-lib/cjs/index.js");', resolveDir: root, sourcefile: 'pdf-lib-offline-entry.js' },
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true,
    // Escape PDF writer line endings inside ordinary strings; never trim their data.
    supported: { 'template-literal': false },
    legalComments: 'inline', write: false,
    banner: { js: `/*! pdf-lib 1.17.1; cooperative wait adapter applied only at build time. */\n${license}` },
    plugins: [{
      name: 'pdf-lib-cooperative-wait',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]pdf-lib[/\\]cjs[/\\]utils[/\\]async\.js$/ }, args => {
          if (path.resolve(args.path) !== path.resolve(asyncPath)) throw new Error('Unexpected pdf-lib async module path.');
          overrides++;
          return { loader: 'js', contents: `"use strict";
            Object.defineProperty(exports, "__esModule", { value: true });
            exports.waitForTick = function () {
              if (typeof globalThis.__PDF_EXPORT_YIELD__ === 'function') return globalThis.__PDF_EXPORT_YIELD__();
              return new Promise(function (resolve) { setTimeout(resolve, 0); });
            };` };
        });
      }
    }]
  });
  if (overrides !== 1) throw new Error('Expected exactly one pinned pdf-lib cooperative-wait override.');
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

export async function buildCmykBundle() {
  const wasm = readFileSync(require.resolve('lcms-wasm/dist/lcms.wasm')).toString('base64');
  // Keep the redistributed production profile byte-for-byte identical to OpenICC.
  // Its original license and download provenance are recorded in licenses/.
  const profile = readFileSync(path.join(root, 'assets/color-profiles/ISOcoated_v2_300_bas.ICC'));
  const expectedProfileHash = 'b424c77f40c3423c925536f8ae08634985ccd0fe80eb253d5d229197ded7e886';
  if (createHash('sha256').update(profile).digest('hex') !== expectedProfileHash) {
    throw new Error('Bundled CMYK profile differs from the verified OpenICC original');
  }
  const profileLicense = readFileSync(path.join(root, 'licenses/basICColor-zlib.txt'), 'utf8');
  const entry = `/*! Bundled ISO Coated v2 300% (basICColor) profile; original bytes unchanged.
${profileLicense}
*/
    import * as engine from 'lcms-wasm';
    globalThis.getBundledCmykProfile = function () {
      return {
        bytes: Uint8Array.from(atob(${JSON.stringify(profile.toString('base64'))}), character => character.charCodeAt(0)),
        name: 'ISO Coated v2 300% (basICColor)',
        description: 'Coated paper, FOGRA39, 300% ink limit. Use a custom profile when your printer specifies one.'
      };
    };
    let loading;
    globalThis.loadCmykEngine = function () {
      if (!loading) {
        const wasmBinary = Uint8Array.from(atob(${JSON.stringify(wasm)}), character => character.charCodeAt(0));
        loading = engine.instantiate({ wasmBinary, locateFile: () => 'lcms-offline.wasm' })
          .then(lcms => ({ lcms, constants: {
            LCMS_VERSION: engine.LCMS_VERSION, TYPE_RGB_8: engine.TYPE_RGB_8,
            TYPE_CMYK_8: engine.TYPE_CMYK_8, TYPE_RGB_16: engine.TYPE_RGB_16,
            TYPE_CMYK_16: engine.TYPE_CMYK_16, cmsInfoDescription: engine.cmsInfoDescription,
            INTENT_RELATIVE_COLORIMETRIC: engine.INTENT_RELATIVE_COLORIMETRIC,
            cmsFLAGS_BLACKPOINTCOMPENSATION: engine.cmsFLAGS_BLACKPOINTCOMPENSATION,
            cmsFLAGS_NOCACHE: engine.cmsFLAGS_NOCACHE
          }})).catch(error => { loading = null; throw error; });
      }
      return loading;
    };`;
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'cmyk-offline-entry.js' },
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true,
    // Emscripten includes an unreachable Node branch. No Node code runs in the UI.
    external: ['module'], define: { 'import.meta.url': '"data:application/javascript,lcms-offline"' },
    legalComments: 'inline', write: false
  });
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

export async function buildPlugin(outputPath = process.env.PDF_EXPORT_UI_OUTPUT || path.join(root, 'ui.html')) {
const source = readFileSync(path.join(root, 'src/ui.html'), 'utf8');
const marker = '<script src="https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>';
if (source.split(marker).length !== 2) throw new Error('Expected exactly one PDF library marker in src/ui.html');
const library = await buildPdfLibrary();
const colorMarker = '<script src="color-profiles.js"></script>';
if (source.split(colorMarker).length !== 2) throw new Error('Expected exactly one color profile helper marker in src/ui.html');
const colorHelper = readFileSync(path.join(root, 'src/color-profiles.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const cmykMarker = '<script src="cmyk.js"></script>';
if (source.split(cmykMarker).length !== 2) throw new Error('Expected exactly one CMYK helper marker in src/ui.html');
const cmykHelper = readFileSync(path.join(root, 'src/cmyk.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const cmykEngine = await buildCmykBundle();
const vectorMarker = '<script src="vector-cmyk.js"></script>';
if (source.split(vectorMarker).length !== 2) throw new Error('Expected exactly one vector CMYK helper marker in src/ui.html');
const jpegBundle = await build({
  stdin: { contents: "import decode from 'jpeg-js/lib/decoder.js'; globalThis.decodeCmykJpeg = decode;", resolveDir: root },
  bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true, legalComments: 'inline', write: false,
  banner: { js: '/*! JPEG decoder: Copyright 2011 notmasteryet. Licensed under Apache-2.0; see licenses/jpeg-js-decoder-Apache-2.0.txt and https://www.apache.org/licenses/LICENSE-2.0 */' }
});
const vectorHelpers = [jpegBundle.outputFiles[0].text, ...['cooperative-yield.js', 'pdf-functions.js', 'pdf-loader.js', 'pdf-image-resolution.js', 'vector-cmyk.js'].map(file => readFileSync(path.join(root, 'src', file), 'utf8'))]
  .map(text => text.replace(/<\/script/gi, '<\\/script')).join('\n');
const output = '<!-- Generated by npm run build. Edit src/ui.html and its helper files. -->\n' + source
  .replace(marker, () => '<script>\n' + library + '\n</script>')
  .replace(colorMarker, () => '<script>\n' + colorHelper + '\n</script>')
  .replace(cmykMarker, () => '<script>\n' + cmykEngine + '\n</script>\n<script>\n' + cmykHelper + '\n</script>')
  .replace(vectorMarker, () => '<script>\n' + vectorHelpers + '\n</script>');
writeFileSync(outputPath, output);
mkdirSync(path.join(root, 'licenses'), { recursive: true });
for (const [, location, filename] of pdfLibraryLicenses) writeFileSync(path.join(root, 'licenses', filename), readFileSync(resolvePdfLicense(location)));
writeFileSync(path.join(root, 'licenses/lcms-wasm-MIT.txt'), readFileSync(require.resolve('lcms-wasm/LICENSE.md')));
writeFileSync(path.join(root, 'licenses/jpeg-js-LICENSE.txt'), readFileSync(require.resolve('jpeg-js/LICENSE')));
console.log(`Built ${outputPath} with bundled pdf-lib and offline LittleCMS; no network requests are required.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPlugin();
