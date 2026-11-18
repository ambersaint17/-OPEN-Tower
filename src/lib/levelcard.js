const { createCanvas } = require('@napi-rs/canvas');

// The progress image shown by /level. The font is registered once at startup by the captcha module
// (assets/fonts/captcha.ttf); if it were missing, the canvas falls back to a default font.
const FONT = 'TowerCaptcha, sans-serif';
const W = 900;
const H = 280;
const AMBER = '#f2a24a';
const GOLD = '#ffd9a0';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const num = (n) => Math.round(n).toLocaleString('en-US');

// data: { level, title, xp, into, needed, fraction, max, booster, streak, nextLabel }
function renderLevelCard(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // card body
  roundRect(ctx, 0, 0, W, H, 30);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0a07');
  bg.addColorStop(1, '#1d1209');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.2, H * 0.5, 10, W * 0.2, H * 0.5, 360);
  glow.addColorStop(0, 'rgba(242,162,74,0.22)');
  glow.addColorStop(1, 'rgba(242,162,74,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.5;
  for (const [y0, cy, y1] of [[220, 70, 150], [255, 120, 195]]) {
    ctx.beginPath();
    ctx.moveTo(-10, y0);
    ctx.quadraticCurveTo(W * 0.5, cy, W + 10, y1);
    ctx.stroke();
  }

  // level badge
  const bx = 150;
  const by = 140;
  const ring = ctx.createLinearGradient(bx - 90, by - 90, bx + 90, by + 90);
  ring.addColorStop(0, GOLD);
  ring.addColorStop(1, '#c97a1f');
  ctx.shadowColor = 'rgba(242,162,74,0.55)';
  ctx.shadowBlur = 26;
  ctx.beginPath();
  ctx.arc(bx, by, 88, 0, Math.PI * 2);
  ctx.fillStyle = '#120d08';
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `17px ${FONT}`;
  ctx.fillText('LEVEL', bx, by - 36);
  ctx.fillStyle = '#f2efea';
  ctx.font = `${String(data.level).length > 1 ? 62 : 78}px ${FONT}`;
  ctx.fillText(String(data.level), bx, by + 40);

  // rank, XP and the booster pill
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER;
  ctx.font = `28px ${FONT}`;
  ctx.fillText(String(data.title).toUpperCase(), 290, 80);
  if (data.booster) {
    const pill = ctx.createLinearGradient(740, 0, 850, 0);
    pill.addColorStop(0, '#d660eb');
    pill.addColorStop(1, '#8b5cf6');
    roundRect(ctx, 735, 52, 115, 34, 17);
    ctx.fillStyle = pill;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `14px ${FONT}`;
    ctx.fillText('BOOSTER', 792, 74);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#f2efea';
  ctx.font = `24px ${FONT}`;
  ctx.fillText(`${num(data.xp)} XP`, 290, 126);
  if (data.streak > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `17px ${FONT}`;
    ctx.fillText(`${data.streak} DAY STREAK`, 850, 124);
    ctx.textAlign = 'left';
  }

  // progress bar
  const px = 290;
  const py = 150;
  const pw = 560;
  const ph = 32;
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = '#1b150d';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3a2a14';
  ctx.stroke();
  const fillW = data.fraction <= 0 ? 0 : Math.max(ph, pw * data.fraction);
  if (fillW > 0) {
    const bar = ctx.createLinearGradient(px, 0, px + pw, 0);
    bar.addColorStop(0, '#e08a2e');
    bar.addColorStop(1, GOLD);
    ctx.save();
    ctx.shadowColor = 'rgba(242,162,74,0.65)';
    ctx.shadowBlur = 20;
    roundRect(ctx, px, py, fillW, ph, ph / 2);
    ctx.fillStyle = bar;
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, px, py, fillW, ph, ph / 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(px, py, fillW, ph / 2.2);
    ctx.restore();
  }

  // numbers under the bar
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `19px ${FONT}`;
  ctx.fillText(data.max ? 'MAX LEVEL' : `${num(data.into)} / ${num(data.needed)} XP`, px, py + ph + 32);
  ctx.textAlign = 'right';
  ctx.fillStyle = AMBER;
  ctx.fillText(data.max ? '100%' : `${Math.floor(data.fraction * 100)}%`, px + pw, py + ph + 32);
  ctx.textAlign = 'left';

  // what comes next
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `17px ${FONT}`;
  ctx.fillText(data.nextLabel ? `NEXT  ${data.nextLabel}` : 'EVERYTHING UNLOCKED', px, 252);

  return canvas.toBuffer('image/png');
}

module.exports = { renderLevelCard };
