import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URL: z
    .string()
    .default('mongodb://localhost:27017/orders?replicaSet=rs0&directConnection=true'),
  // no default on purpose: a forgotten secret should fail the boot, not
  // silently ship a guessable one
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars (openssl rand -hex 32)'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
