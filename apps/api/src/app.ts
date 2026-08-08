import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import { errorHandler } from './errors.js';

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    // behind a proxy in production (App Runner / ALB) the client ip and
    // protocol come from x-forwarded-*
    trustProxy: true,
  });

  app.decorate('config', config);
  app.setErrorHandler(errorHandler);

  await app.register(cookie);
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}
