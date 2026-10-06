import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createOrder, getOrder, listOrders } from './orders.js';
import { listStock } from './inventory.js';
import { formatInvoiceDate } from './dates.js';

const PORT = Number(process.env.PORT ?? 3000);

function send(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'content-type': type });
  response.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

async function route(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/') {
    const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8').catch(() => '<h1>Tidewater</h1>');
    return send(response, 200, page, 'text/html');
  }
  if (request.method === 'GET' && url.pathname === '/api/orders') {
    const status = url.searchParams.get('status') ?? undefined;
    return send(response, 200, listOrders({ status }));
  }
  const match = /^\/api\/orders\/(ord_\d+)$/.exec(url.pathname);
  if (request.method === 'GET' && match) {
    const order = getOrder(match[1]);
    if (!order) return send(response, 404, { error: 'No such order.' });
    return send(response, 200, { ...order, invoiceDate: formatInvoiceDate(order.placedAt) });
  }
  if (request.method === 'POST' && url.pathname === '/api/orders') {
    try {
      return send(response, 201, createOrder(await readJson(request)));
    } catch (error) {
      return send(response, 422, { error: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/inventory')
    return send(response, 200, listStock());
  return send(response, 404, { error: 'Not found.' });
}

export const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  route(request, response, url).catch((error) => {
    console.error(error);
    send(response, 500, { error: 'Something went wrong.' });
  });
});

if (import.meta.url === 'file://' + process.argv[1]) {
  server.listen(PORT, () => console.log('Tidewater listening on http://localhost:' + PORT));
}
