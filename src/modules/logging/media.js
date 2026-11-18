const { AttachmentBuilder } = require('discord.js');
const { logging } = require('../../constants');
const { safeFilename } = require('../../lib/text');

// A deleted image's CDN link can die at any moment, so grab a copy right away and
// re-upload it to the media log. Images only, capped in count and size.
async function fetchImages(attachments) {
  const files = [];
  const names = [];
  for (const attachment of attachments) {
    if (files.length >= logging.mediaMaxFiles) break;
    if (!attachment.contentType?.startsWith('image/')) continue;
    if (attachment.size > logging.mediaMaxBytes) continue;
    try {
      const response = await fetch(attachment.url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const name = safeFilename(attachment.name, files.length);
      files.push(new AttachmentBuilder(Buffer.from(await response.arrayBuffer()), { name }));
      names.push(name);
    } catch {
      // The link was already gone. Nothing to recover.
    }
  }
  return { files, names };
}

module.exports = { fetchImages };
