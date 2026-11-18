const { renderCaptcha } = require('../../lib/captcha');
const { generateCode } = require('../../lib/codes');
const { tiers } = require('../../constants');

// Drawing a captcha is the slowest part of pressing Verify, so a few are drawn ahead of time, one at a time,
// in the gaps between other work. A captcha is handed out once and never reused. If the stock runs dry, the
// caller just draws one itself, exactly as before.
// Captchas kept ready per difficulty. 2 is enough for most servers; CAPTCHA_POOL_SIZE=0 draws on demand and uses the least memory.
function defaultSize() {
  const n = Number(process.env.CAPTCHA_POOL_SIZE);
  return process.env.CAPTCHA_POOL_SIZE && Number.isInteger(n) && n >= 0 ? n : 2;
}

function createPool({ render = renderCaptcha, generate = generateCode, tierList = tiers, size = defaultSize() } = {}) {
  const stock = new Map(Object.keys(tierList).map((t) => [Number(t), []]));
  let filling = null;

  const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

  async function fill() {
    for (const [tier, items] of stock) {
      while (items.length < size) {
        await yieldToEventLoop();                       // let buttons and messages be handled between drawings
        const code = generate(tierList[tier].length);
        items.push({ code, image: render(code, tier) });
      }
    }
  }

  // Starts topping up in the background. Safe to call as often as you like.
  function refill() {
    if (!filling) filling = fill().catch((err) => console.error('[verify] captcha pool:', err.message)).finally(() => { filling = null; });
    return filling;
  }

  // A ready captcha for this tier, or null.
  function take(tier) {
    const item = stock.get(tier)?.shift() ?? null;
    refill();
    return item;
  }

  const counts = () => Object.fromEntries([...stock].map(([t, items]) => [t, items.length]));
  return { take, refill, counts };
}

module.exports = { createPool, pool: createPool() };
