const clip = (value, max = 1000) => (value.length > max ? `${value.slice(0, max - 1)}\u2026` : value);

// Block-quote text so it is clearly separated from Tower's own wording.
const quote = (value, max = 1000) =>
  clip(value, max)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

// What was added to and removed from a list of ids.
function diffLists(before, after) {
  return {
    added: after.filter((x) => !before.includes(x)),
    removed: before.filter((x) => !after.includes(x)),
  };
}

const listOrNone = (items, max = 10) => {
  if (!items.length) return '`none`';
  const shown = items.slice(0, max).join(' ');
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
};

// Keeps filenames from Discord safe when Tower re-uploads them.
function safeFilename(name, index) {
  const ext = (String(name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'png';
  return `deleted-${index + 1}.${ext.toLowerCase()}`;
}

// 42 -> "#0042"
const caseLabel = (n) => `#${String(n).padStart(4, '0')}`;

module.exports = { clip, quote, diffLists, listOrNone, safeFilename, caseLabel };
