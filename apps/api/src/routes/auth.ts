import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/user.js';
import { HttpError } from '../errors.js';

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (req, reply) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      const user = await User.create({ email, passwordHash });
      app.setAuthCookie(reply, user._id.toString());
      return reply.status(201).send({ id: user._id, email: user.email });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
        throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    // same error for unknown email and wrong password — no account enumeration
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    app.setAuthCookie(reply, user._id.toString());
    return { id: user._id, email: user.email };
  });

  app.post('/auth/logout', async (_req, reply) => {
    app.clearAuthCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const user = await User.findById(req.userId).select('email');
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
    return { id: user._id, email: user.email };
  });
}
