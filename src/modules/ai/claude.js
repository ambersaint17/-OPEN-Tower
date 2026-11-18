const config = require('../../config');
const { ai } = require('../../constants');
const { detectProvider } = require('../../lib/ai');

// A failure with a message that is safe to show members. `kind` says what went wrong, and `cooldownMs` how long
// that model should rest before it is tried again. kind: auth | credit | rate | down | model | empty | other
class AiError extends Error {
  constructor(message, { kind = 'other', cooldownMs = null } = {}) {
    super(message);
    this.kind = kind;
    this.cooldownMs = cooldownMs;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MINUTE = 60_000; const DAY = 24 * 60 * MINUTE;

const providerNow = () => detectProvider({ key: config.aiApiKey, provider: config.aiProvider, baseUrl: config.aiBaseUrl });
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// The model to call. A model set with /ai settings wins, then AI_MODEL. Otherwise Anthropic uses the Haiku/Sonnet choice, and OpenRouter its automatic router.
function modelFor(choice, provider = providerNow(), override = null) {
  if (override) return override;
  if (config.aiModel) return config.aiModel;
  if (provider === 'anthropic') return ai.models[choice] ?? ai.models.haiku;
  if (provider === 'openrouter') return 'openrouter/auto';
  return null;
}
const describe = () => ({ provider: providerNow(), model: modelFor('haiku') });

// How long a model that ran out should rest. The service's own hint wins, then "daily limit" means until midnight UTC, else a minute.
function restAfterRateLimit(headers, detail, now = Date.now()) {
  const get = (name) => (typeof headers?.get === 'function' ? headers.get(name) : null);
  const clamp = (ms) => Math.min(Math.max(ms, 5000), DAY + 60 * MINUTE);
  const retryAfter = Number(get('retry-after'));
  if (retryAfter > 0) return clamp(retryAfter * 1000);
  const reset = Number(get('x-ratelimit-reset'));
  if (reset > 0) {
    const at = reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : 0;
    if (at > now) return clamp(at - now);
  }
  if (/per[- ]?day|daily|per 24|free-models-per-day/i.test(String(detail))) {
    const next = new Date(now); next.setUTCHours(24, 0, 5, 0);
    return clamp(next.getTime() - now);
  }
  return MINUTE;
}

// system: [{ text, cache }]; messages: [{ role, content }]. Returns { text, tokens, input, output }.
// apiKey, provider, baseUrl and fetchImpl can be passed in, which the tests do.
async function complete({
  model, system, messages, maxTokens, apiKey = config.aiApiKey, provider = providerNow(), baseUrl = config.aiBaseUrl, fetchImpl = fetch, retryDelayMs = 1500,
}) {
  if (!apiKey) throw new AiError('The AI assistant is not set up yet. The owner needs to add an API key.', { kind: 'auth' });
  if (!model) throw new AiError('The AI assistant has no model set. The owner needs to add AI_MODEL.', { kind: 'auth' });
  const anthropic = provider === 'anthropic';
  const url = anthropic ? 'https://api.anthropic.com/v1/messages' : provider === 'openrouter' ? OPENROUTER_URL : `${baseUrl}/chat/completions`;
  if (!anthropic && provider !== 'openrouter' && !baseUrl) throw new AiError('The AI assistant has no service address. The owner needs to add AI_BASE_URL.', { kind: 'auth' });

  const headers = { 'content-type': 'application/json' };
  let payload;
  if (anthropic) {
    headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    payload = { model, max_tokens: maxTokens, messages, system: system.map((b) => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) })) };
  } else {
    headers.authorization = `Bearer ${apiKey}`;
    if (provider === 'openrouter') headers['x-title'] = 'Tower';
    payload = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system.map((b) => b.text).join('\n\n') }, ...messages] };
  }
  // Some models "think" first, and a short answer limit can be used up before any answer appears. For OpenRouter, an empty
  // answer is therefore tried once more with thinking switched off (models that cannot switch it off ignore this).
  const makeBody = (noReasoning) => JSON.stringify(noReasoning ? { ...payload, reasoning: { enabled: false } } : payload);
  let noReasoning = false;
  let body = makeBody(false);

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(ai.requestTimeoutMs) });
    } catch {
      if (attempt === 0) { await sleep(retryDelayMs); continue; }
      throw new AiError('The assistant could not be reached. Please try again in a moment.', { kind: 'down', cooldownMs: MINUTE });
    }

    if (res.ok) {
      const data = await res.json();
      // Some services answer 200 and put the failure in the body.
      if (data.error && !data.choices && !data.content) {
        const code = Number(data.error.code) || 0;
        const text = JSON.stringify(data.error);
        const rest = code === 429 ? restAfterRateLimit(res.headers, text) : null;
        if ((code >= 500 || (code === 429 && rest <= 10_000)) && attempt === 0) { await sleep(retryDelayMs); continue; }
        console.error('[ai] provider error:', text.slice(0, 300));
        if (code === 402) throw new AiError('The AI account has run out of credit.', { kind: 'credit', cooldownMs: 30 * MINUTE });
        if (code === 429) throw new AiError('The assistant is busy right now. Please try again in a minute.', { kind: 'rate', cooldownMs: rest });
        throw new AiError('The assistant could not answer that right now.', { kind: code >= 500 ? 'down' : 'other', cooldownMs: 5 * MINUTE });
      }
      if (anthropic) return readAnthropic(data);
      try {
        return readOpenAi(data);
      } catch (err) {
        if (provider === 'openrouter' && !noReasoning && err instanceof AiError) { noReasoning = true; body = makeBody(true); continue; }
        throw err;
      }
    }

    const detail = await res.text().catch(() => '');
    const rest = res.status === 429 ? restAfterRateLimit(res.headers, detail) : null;
    // Only a short wait is worth retrying. A daily limit is not going to clear in a second.
    if (attempt === 0 && (res.status >= 500 || (res.status === 429 && rest <= 10_000))) { await sleep(retryDelayMs); continue; }
    if (res.status === 401 || res.status === 403) throw new AiError('The AI key was rejected. The owner needs to check the API key.', { kind: 'auth' });
    if (res.status === 402) throw new AiError('The AI account has run out of credit. The owner needs to top it up, or pick a free model.', { kind: 'credit', cooldownMs: 30 * MINUTE });
    if (res.status === 429) throw new AiError('The assistant is busy right now. Please try again in a minute.', { kind: 'rate', cooldownMs: rest });
    if (res.status >= 500) throw new AiError('The AI service is having problems. Please try again shortly.', { kind: 'down', cooldownMs: MINUTE });
    console.error(`[ai] request refused (${res.status}) for model "${model}":`, detail.slice(0, 300));
    if (res.status === 404) throw new AiError('The AI model could not be found. The owner needs to check the model ID.', { kind: 'model', cooldownMs: 60 * MINUTE });
    throw new AiError('The assistant could not answer that. Try rephrasing, or ask staff.', { kind: 'other', cooldownMs: 5 * MINUTE });
  }
}

const empty = () => new AiError('The assistant had nothing to say. Try rephrasing your question.', { kind: 'empty', cooldownMs: 10 * MINUTE });

function readAnthropic(data) {
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw empty();
  const u = data.usage ?? {};
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return { text, input, output: u.output_tokens ?? 0, tokens: input + (u.output_tokens ?? 0) };
}

function readOpenAi(data) {
  const content = data.choices?.[0]?.message?.content;
  const text = (Array.isArray(content) ? content.map((p) => p.text ?? '').join('') : content ?? '').trim();
  if (!text) throw empty();
  const u = data.usage ?? {};
  const input = u.prompt_tokens ?? 0; const output = u.completion_tokens ?? 0;
  return { text, input, output, tokens: u.total_tokens ?? input + output };
}

module.exports = { complete, modelFor, describe, providerNow, restAfterRateLimit, AiError };
