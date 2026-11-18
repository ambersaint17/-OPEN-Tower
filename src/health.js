const http = require('node:http');

// Some free hosts (Render, Koyeb, Railway, Replit, Fly...) run a bot as a "web service" and stop it if nothing
// answers on its port. When the host gives Tower a PORT, this tiny server answers 200 so the bot stays up.
// It serves no data and nothing else. Without PORT it does not start at all.
function startHealthServer({ port = process.env.PORT, getStatus = () => ({ ok: true }) } = {}) {
  if (!port) return null;
  const server = http.createServer((req, res) => {
    const status = getStatus();
    res.writeHead(status.ok ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(status.ok ? 'Tower is running.\n' : 'Tower is starting.\n');
  });
  server.on('error', (err) => console.error('[health]', err.message));
  server.listen(Number(port), '0.0.0.0', () => console.log(`[health] listening on port ${port}`));
  server.unref();
  return server;
}

module.exports = { startHealthServer };
