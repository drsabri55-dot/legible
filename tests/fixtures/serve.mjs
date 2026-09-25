// A tiny static server for the fixture website used by the tests.
// Usage: node tests/fixtures/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const types = { ".html": "text/html; charset=utf-8", ".txt": "text/plain", ".png": "image/png" };

export function serveFixture(port = Number(process.argv[2] || 5055)) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    const file = path.join(root, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" }).end("<!doctype html><title>Not found</title><h1>Not found</h1>");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await serveFixture();
  console.log(`fixture site on http://127.0.0.1:${process.argv[2] || 5055}`);
}
