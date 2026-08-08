import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDb } from './db.js';

const config = loadConfig();

const app = await buildApp(config);
await connectDb(config.MONGO_URL);

await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
