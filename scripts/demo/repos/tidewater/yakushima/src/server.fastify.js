import Fastify from 'fastify';
import { createOrder, getOrder, listOrders } from './orders.js';
import { listStock } from './inventory.js';

const app = Fastify({ logger: true });

app.get('/api/orders', async (request) =>
  listOrders({ status: request.query.status }),
);

app.get('/api/orders/:id', async (request, reply) => {
  const order = getOrder(request.params.id);
  return order ?? reply.code(404).send({ error: 'No such order.' });
});

app.post('/api/orders', async (request, reply) => {
  try {
    return reply.code(201).send(createOrder(request.body));
  } catch (error) {
    return reply.code(422).send({ error: error.message });
  }
});

app.get('/api/inventory', async () => listStock());

await app.listen({ port: Number(process.env.PORT ?? 3000) });
