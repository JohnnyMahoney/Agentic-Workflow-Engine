import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const html = new URL('../examples/discovery-handoff/index.html', import.meta.url);
const server = createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/index.html'].includes(request.url)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(readFileSync(html));
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(8081, '127.0.0.1', () => console.log('Discovery handoff demo: http://localhost:8081/'));
