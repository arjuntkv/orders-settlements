import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors.js';

const COOKIE_NAME = 'token';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) throw unauthorized();
    try {
      const payload = jwt.verify(token, app.config.JWT_SECRET) as { sub: string };
      req.userId = payload.sub;
    } catch {
      throw unauthorized('Session expired or invalid, log in again');
    }
  });

  app.decorate('setAuthCookie', (reply: FastifyReply, userId: string) => {
    const token = jwt.sign({ sub: userId }, app.config.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.NODE_ENV === 'production',
      path: '/',
      maxAge: TOKEN_TTL_SECONDS,
    });
  });

  app.decorate('clearAuthCookie', (reply: FastifyReply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    setAuthCookie: (reply: FastifyReply, userId: string) => void;
    clearAuthCookie: (reply: FastifyReply) => void;
  }
}
