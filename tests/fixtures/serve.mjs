// A tiny static server for the fixture website used by the tests.
// Usage: node tests/fixtures/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "site");
const types = { ".html": "text/html; charset=utf-8", ".txt": "text/plain", ".png": "image/png" };

export function serveFixture(port = Number(process.argv[2] || 5055)) {
  let posts = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    // The testing agent must never submit anything: tests read this count.
    if (url.pathname === "/__posts") return res.writeHead(200, { "content-type": "text/plain" }).end(String(posts));
    if (req.method !== "GET" && req.method !== "HEAD") {
      posts++;
      return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Sent</title><p>Sent</p>");
    }
    // A link that redirects back to the home page, and one that leaves the
    // site (127.0.0.1 and localhost count as different sites).
    if (url.pathname === "/home") return res.writeHead(302, { location: "/" }).end();
    // A slow page, like a real site's server: answers after one second.
    if (url.pathname.startsWith("/slow/")) {
      await new Promise((r) => setTimeout(r, 1000));
      return res.writeHead(302, { location: url.pathname.slice(5) }).end();
    }
    if (url.pathname === "/elsewhere") return res.writeHead(302, { location: `http://localhost:${port}/about.html` }).end();
    const file = path.join(root, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      let body = await readFile(file);
      // Pages embed content from "another site" (localhost) on the same port.
      if (file.endsWith(".html")) body = Buffer.from(body.toString("utf8").replaceAll("__PORT__", String(port)));
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
