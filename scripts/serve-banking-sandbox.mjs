import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Use --port with an integer from 1 to 65535");

// Serve only the bundled fixture, never project source, evidence or .env files.
const files = new Map([
  ["/", "index.html"], ["/index.html", "index.html"],
  ["/modern.html", "modern.html"], ["/awkward.html", "awkward.html"],
  ["/shared.js", "shared.js"], ["/legacy/", "legacy/index.html"],
  ["/legacy/index.html", "legacy/index.html"], ["/legacy/content.html", "legacy/content.html"],
]);
const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/legacy") {
    response.writeHead(302, { Location: "/legacy/" }).end();
    return;
  }
  const file = files.get(pathname);
  if (!file) { response.writeHead(404).end("Not found"); return; }
  try {
    const body = await readFile(new URL(`../banking-sandbox/${file}`, import.meta.url));
    response.writeHead(200, {
      "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(500).end("Bundled sandbox file could not be read");
  }
});
server.on("error", error => {
  console.error(error.code === "EADDRINUSE"
    ? `Port ${port} is in use. Stop the existing server or use --port 8081.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Banking Sandbox: http://localhost:${port}/ (Ctrl+C to stop)`));
