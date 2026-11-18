const test = require('node:test');
const assert = require('node:assert/strict');
const { initCaptcha, renderCaptcha } = require('../src/lib/captcha');

test('a captcha is a 560x180 JPEG for every difficulty', () => {
  initCaptcha();
  for (const tier of [1, 2, 3]) {
    const img = renderCaptcha('K7RQXMB'.slice(0, 4 + tier), tier);
    assert.ok(Buffer.isBuffer(img));
    assert.deepEqual([...img.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG header');
    assert.ok(img.length > 5000 && img.length < 80_000, `sensible size, got ${img.length}`);
  }
});

test('drawing captchas does not pile up native memory (it used to cost about 220 MB each)', () => {
  initCaptcha();
  renderCaptcha('WARMUP', 2);
  const before = process.memoryUsage().rss;
  for (let i = 0; i < 12; i++) renderCaptcha('ABCDE7', 3);
  const grownMB = (process.memoryUsage().rss - before) / 1048576;
  assert.ok(grownMB < 120, `12 captchas grew memory by ${grownMB.toFixed(0)} MB`);
});
