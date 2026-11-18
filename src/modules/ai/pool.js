// Which model the assistant is using right now, per server. It stays on one model until that one runs out,
// then moves to the next, and comes back round to the first when the other one runs out in turn.
// Nothing here is stored: after a restart it simply starts from the first model again.
const states = new Map();   // guildId -> { current: index, resting: Map(model -> untilMs) }

const stateOf = (guildId) => {
  if (!states.has(guildId)) states.set(guildId, { current: 0, resting: new Map() });
  return states.get(guildId);
};

// The models in order: the main one, then the backups.
const listFor = (primary, backups = []) => [...new Set([primary, ...backups].filter(Boolean))];

const isResting = (state, model, now) => (state.resting.get(model) ?? 0) > now;

// The model to use now, or null when every one of them is resting.
function pick(guildId, models, now = Date.now()) {
  const state = stateOf(guildId);
  for (let step = 0; step < models.length; step++) {
    const index = (state.current + step) % models.length;
    if (!isResting(state, models[index], now)) return models[index];
  }
  return null;
}

// A model answered, so it becomes the current one. Switching is logged so the owner can see it in the console.
function used(guildId, models, model) {
  const state = stateOf(guildId);
  const index = models.indexOf(model);
  if (index !== -1 && state.current !== index) {
    console.log(`[ai] now using ${model}`);
    state.current = index;
  }
}

// A model ran out. It rests for `ms`, and the next model that is awake takes over.
function failed(guildId, models, model, ms, now = Date.now()) {
  const state = stateOf(guildId);
  state.resting.set(model, now + ms);
  const next = pick(guildId, models, now);
  console.log(`[ai] ${model} is resting for ${Math.round(ms / 60000)} min${next ? `, switching to ${next}` : ', no other model is available'}`);
  if (next) used(guildId, models, next);
}

// For /ai status: each model with whether it is the active one and when it wakes up.
function snapshot(guildId, models, now = Date.now()) {
  const state = stateOf(guildId);
  return models.map((model, index) => ({
    model, active: index === state.current % Math.max(models.length, 1),
    restingUntil: isResting(state, model, now) ? state.resting.get(model) : null,
  }));
}

const reset = (guildId) => { if (guildId) states.delete(guildId); else states.clear(); };

module.exports = { listFor, pick, used, failed, snapshot, reset };
