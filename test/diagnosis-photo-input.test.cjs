const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clipboardPhotos, photoSelectionError } = require('../client/src/pages/HomePage/photo-input');
const photo = (name, type = 'image/png', size = 100) => new File([new Uint8Array(size)], name, { type });

test('single and batch paste keep each file once across clipboard representations', () => {
  const files = [photo('one.png'), photo('two.png')];
  const items = files.map(file => ({ kind: 'file', getAsFile: () => file }));
  assert.deepEqual(clipboardPhotos({ files, items }), files);
  assert.deepEqual(clipboardPhotos({ files: [], items }), files);
  assert.deepEqual(clipboardPhotos({ files: [files[0]], items: [] }), [files[0]]);
  assert.deepEqual(clipboardPhotos({ files: [], items: [{ kind: 'string', getAsFile: () => null }] }), []);
  assert.deepEqual(clipboardPhotos({ files: [photo('text.txt', 'text/plain')], items: [] }), []);
});

test('picker, drop and paste share MIME, count, individual and aggregate limits', () => {
  assert.equal(photoSelectionError([photo('one.png')]), '');
  assert.match(photoSelectionError(Array.from({ length: 7 }, (_, i) => photo(`${i}.png`))), /6 张/u);
  assert.match(photoSelectionError([photo('bad.gif', 'image/gif')]), /JPG、PNG、WebP/u);
  assert.match(photoSelectionError([photo('big.png', 'image/png', 10 * 1024 * 1024 + 1)]), /10 MB/u);
  assert.match(photoSelectionError([photo('a.png', 'image/png', 7 * 1024 * 1024), photo('b.png', 'image/png', 6 * 1024 * 1024)]), /12 MB/u);
  assert.equal(photoSelectionError([photo('a.png', 'image/png', 6 * 1024 * 1024), photo('b.webp', 'image/webp', 6 * 1024 * 1024)]), '');
});
