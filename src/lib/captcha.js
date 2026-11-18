const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { tiers } = require('../constants');

const FAMILY = 'TowerCaptcha';
const FONT_PATH = path.join(__dirname, '..', '..', 'assets', 'fonts', 'captcha.ttf');
const WIDTH = 560;
const HEIGHT = 180;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Call once at startup so a missing font fails loudly instead of rendering blank images.
function initCaptcha() {
  let key = null;
  try {
    key = GlobalFonts.registerFromPath(FONT_PATH, FAMILY);
  } catch {
    key = null;
  }
  if (!key) {
    throw new Error(`Captcha font not found or unreadable: ${FONT_PATH}. Add a .ttf file named captcha.ttf there.`);
  }
}

// Returns a JPEG: it is a fraction of the size of a PNG, so it uploads and appears much faster, and noise hides the artefacts.
function renderCaptcha(code, tierNumber) {
  const tier = tiers[tierNumber];
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Dark brand background.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#0b0a09');
  bg.addColorStop(1, '#1a140e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Speckle behind the letters.
  for (let i = 0; i < tier.dots; i++) {
    ctx.fillStyle = `rgba(${pick(['242,162,74', '233,220,200', '120,110,100'])},${rand(0.15, 0.5)})`;
    ctx.beginPath();
    ctx.arc(rand(0, WIDTH), rand(0, HEIGHT), rand(0.6, 2), 0, Math.PI * 2);
    ctx.fill();
  }

  // Letters: each one gets its own rotation, scale, offset and colour.
  const slot = (WIDTH - 90) / code.length;
  const size = Math.round(Math.min(62, slot * 0.92));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [...code].forEach((char, i) => {
    ctx.save();
    ctx.translate(45 + slot * (i + 0.5) + rand(-4, 4), HEIGHT / 2 + rand(-14, 14));
    ctx.rotate(rand(-tier.rotation, tier.rotation));
    ctx.scale(rand(0.9, 1.1), rand(0.9, 1.15));
    ctx.font = `${size}px ${FAMILY}`;
    ctx.fillStyle = pick(['#f2efea', '#e9dcc8', '#f2a24a', '#d9c7aa']);
    ctx.fillText(char, 0, 0);
    ctx.restore();
  });

  // Thin curves that cross the letters.
  for (let i = 0; i < tier.lines; i++) {
    ctx.strokeStyle = `rgba(${pick(['242,162,74', '233,220,200', '150,140,130'])},${rand(0.35, 0.7)})`;
    ctx.lineWidth = rand(1, 2.2);
    ctx.beginPath();
    ctx.moveTo(rand(0, 40), rand(10, HEIGHT - 10));
    ctx.bezierCurveTo(rand(120, 260), rand(0, HEIGHT), rand(300, 440), rand(0, HEIGHT), rand(WIDTH - 40, WIDTH), rand(10, HEIGHT - 10));
    ctx.stroke();
  }

  // Wave distortion: every pixel column is shifted up or down a little.
  // This moves the pixels directly in one buffer. (Drawing 560 one-pixel strips from the canvas looks the same,
  // but every strip makes a full copy of the canvas in native memory: about 220 MB per captcha, which crashes small hosts.)
  const src = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
  const out = createCanvas(WIDTH, HEIGHT);
  const octx = out.getContext('2d');
  const shifted = octx.createImageData(WIDTH, HEIGHT);
  const dst = shifted.data;
  for (let i = 0; i < dst.length; i += 4) { dst[i] = 0x0b; dst[i + 1] = 0x0a; dst[i + 2] = 0x09; dst[i + 3] = 255; }
  const phase = rand(0, Math.PI * 2);
  const period = rand(60, 95);
  for (let x = 0; x < WIDTH; x++) {
    const dy = Math.round(Math.sin((x / period) * Math.PI * 2 + phase) * tier.wave);
    const from = Math.max(0, -dy);
    const to = Math.min(HEIGHT, HEIGHT - dy);
    for (let y = from; y < to; y++) {
      const s4 = (y * WIDTH + x) * 4;
      const d4 = ((y + dy) * WIDTH + x) * 4;
      dst[d4] = src[s4]; dst[d4 + 1] = src[s4 + 1]; dst[d4 + 2] = src[s4 + 2]; dst[d4 + 3] = src[s4 + 3];
    }
  }
  octx.putImageData(shifted, 0, 0);

  return out.toBuffer('image/jpeg', 88);
}

module.exports = { initCaptcha, renderCaptcha };
