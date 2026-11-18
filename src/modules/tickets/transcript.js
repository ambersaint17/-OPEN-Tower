// Builds a self-contained HTML transcript. Everything a member typed is escaped, there is no
// JavaScript in the page, and a strict Content-Security-Policy lets the browser load nothing except
// Discord's own image CDN. Open it by double-clicking the file.
const CDN_HOSTS = ['https://cdn.discordapp.com/', 'https://media.discordapp.net/'];

// Escapes markup, and writes every character outside plain ASCII (accents, emoji, other scripts)
// as a numeric reference. The file is therefore pure ASCII: it reads correctly whatever encoding
// a browser or Discord's file viewer assumes.
const SPECIAL = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

function escapeHtml(value) {
  let out = '';
  for (const ch of String(value ?? '')) {
    const cp = ch.codePointAt(0);
    if (SPECIAL[ch]) out += SPECIAL[ch];
    else if (ch === '\n' || ch === '\t') out += ch;
    else if (cp < 32 || (cp >= 127 && cp <= 159)) out += ''; // control characters are dropped
    else if (cp > 126) out += `&#${cp};`;
    else out += ch;
  }
  return out;
}

// Only Discord CDN links are ever turned into links or images. Anything else is shown as plain text.
const safeUrl = (url) => (typeof url === 'string' && CDN_HOSTS.some((h) => url.startsWith(h)) ? url : null);

const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : 'unknown');

// Pulls readable text out of Components V2 messages (Tower's own cards).
function componentsText(components = []) {
  const out = [];
  for (const c of components) {
    const text = c?.content ?? c?.data?.content;
    if (typeof text === 'string' && text) out.push(text);
    for (const nested of [c?.components, c?.accessory ? [c.accessory] : null]) {
      if (Array.isArray(nested)) out.push(...componentsText(nested));
    }
  }
  return out;
}

function renderMessage(m) {
  const attachments = (m.attachments ?? []).map((a) => {
    const url = safeUrl(a.url);
    const name = escapeHtml(a.name);
    if (url && String(a.contentType ?? '').startsWith('image/')) {
      return `<div class="att"><a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${name}</a><br><img src="${escapeHtml(url)}" alt="${name}" loading="lazy"></div>`;
    }
    return url
      ? `<div class="att"><a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${name}</a></div>`
      : `<div class="att">${name}</div>`;
  }).join('');

  const text = m.content ? escapeHtml(m.content).replace(/\n/g, '<br>') : '';
  const card = (m.cardText ?? []).length
    ? `<div class="card">${escapeHtml(m.cardText.join('\n')).replace(/\n/g, '<br>')}</div>`
    : '';
  const avatar = safeUrl(m.avatarUrl);

  return `<div class="msg">
${avatar ? `<img class="av" src="${escapeHtml(avatar)}" alt="" loading="lazy">` : '<div class="av"></div>'}
<div class="main"><div class="meta"><span class="name">${escapeHtml(m.authorTag)}</span>${m.bot ? '<span class="badge">APP</span>' : ''}<time>${escapeHtml(when(m.createdTimestamp))}</time>${m.editedTimestamp ? '<span class="edited">(edited)</span>' : ''}</div>
<div class="body">${text || (card || attachments ? '' : '<span class="muted">(no text)</span>')}</div>${card}${attachments}</div>
</div>`;
}

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#0b0d12;color:#e6e8ee;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:28px 18px 60px}
header{border:1px solid #1f2a52;border-left:4px solid #2b4fc4;background:#10142a;border-radius:10px;padding:18px 20px;margin-bottom:22px}
h1{margin:0 0 4px;font-size:22px}.sub{color:#9aa3c0;font-size:13px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:14px 0 0;font-size:14px}dt{color:#9aa3c0}dd{margin:0}
.msg{display:flex;gap:12px;padding:10px 6px;border-bottom:1px solid #151a2e}.av{width:40px;height:40px;border-radius:50%;background:#1b2140;flex:none;object-fit:cover}
.main{min-width:0}.meta{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.name{font-weight:600}time,.edited,.muted{color:#7f89a8;font-size:12px}
.badge{background:#2b4fc4;color:#fff;border-radius:4px;font-size:10px;padding:1px 5px}
.body{word-wrap:break-word;overflow-wrap:anywhere}.card{margin-top:6px;border-left:3px solid #2b4fc4;background:#10142a;padding:8px 12px;border-radius:6px;font-size:14px;white-space:normal}
.att{margin-top:6px}.att img{max-width:420px;max-height:320px;border-radius:8px;margin-top:4px}a{color:#7fa0ff}
footer{margin-top:28px;color:#7f89a8;font-size:12px;text-align:center}
`;

// ticket: { number, typeLabel, openerTag, claimedTag, closedTag, reason, openedAt, closedAt }
function renderTranscript({ ticket, guildName, messages, generatedAt = Date.now(), truncated = false }) {
  const rows = [
    ['Opened by', ticket.openerTag], ['Claimed by', ticket.claimedTag ?? 'Nobody'],
    ['Closed by', ticket.closedTag ?? 'Unknown'], ['Close reason', ticket.reason ?? 'No reason given'],
    ['Opened', when(ticket.openedAt)], ['Closed', when(ticket.closedAt)], ['Messages', String(messages.length)],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://cdn.discordapp.com https://media.discordapp.net; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(`Ticket #${String(ticket.number).padStart(4, '0')} transcript`)}</title>
<style>${CSS}</style></head>
<body><div class="wrap">
<header><h1>${escapeHtml(`Ticket #${String(ticket.number).padStart(4, '0')}`)} &middot; ${escapeHtml(ticket.typeLabel)}</h1>
<div class="sub">${escapeHtml(guildName)}</div>
<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl></header>
${truncated ? '<p class="muted">This transcript was cut short because the ticket was very long.</p>' : ''}
${messages.map(renderMessage).join('\n')}
<footer>Generated ${escapeHtml(when(generatedAt))} by Tower. This file contains no scripts and loads nothing except Discord images.</footer>
</div></body></html>`;
}

module.exports = { renderTranscript, escapeHtml, safeUrl, componentsText };
