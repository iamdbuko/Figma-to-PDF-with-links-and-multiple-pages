const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('the distributed UI carries complete applicable dependency notices', () => {
  const html = fs.readFileSync(process.env.PDF_EXPORT_TEST_UI || path.join(root, 'ui.html'), 'utf8');
  const notices = [
    'pdf-lib-MIT.txt', 'pdf-lib-standard-fonts-MIT.txt', 'pdf-lib-upng-MIT.txt',
    'pako-MIT.txt', 'tslib-0BSD.txt', 'lcms-wasm-MIT.txt', 'littlecms-MIT.txt',
    'jpeg-js-LICENSE.txt', 'jpeg-js-decoder-Apache-2.0.txt', 'basICColor-zlib.txt'
  ];
  for (const filename of notices) {
    const text = fs.readFileSync(path.join(root, 'licenses', filename), 'utf8').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    assert(html.includes(text), `${filename} must travel with the runtime, not only the repository`);
  }
  assert(html.includes('Copyright 2011 notmasteryet'));
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i, 'the runtime remains self-contained');
});

test('runtime notices normalize line endings and cannot end their script or comment', async () => {
  const { runtimeLicenseComment } = await import('../scripts/build.mjs');
  assert.equal(runtimeLicenseComment('License', 'First\r\nSecond\rThird\n'), '/*! License\nFirst\nSecond\nThird\n*/');
  const notice = runtimeLicenseComment('Test', '*/ globalThis.injected = true; /* </ScRiPt>');
  assert.doesNotMatch(notice, /<\/script/i);
  assert.equal((notice.match(/\*\//g) || []).length, 1, 'only the final comment delimiter is allowed');
  const context = {};
  vm.runInNewContext(notice + '\nglobalThis.afterNotice = true;', context);
  assert.equal(context.injected, undefined);
  assert.equal(context.afterNotice, true);
});
