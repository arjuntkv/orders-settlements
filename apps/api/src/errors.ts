import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '@orders/core';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);

const DOMAIN_STATUS: Record<string, number> = {
  OVERPAYMENT: 422,
  ORDER_NOT_PAYABLE: 409,
  // remaining domain codes are input problems
};

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ code: err.code, message: err.message, details: err.details });
  }
  if (err instanceof DomainError) {
    const status = DOMAIN_STATUS[err.code] ?? 400;
    return reply.status(status).send({ code: err.code, message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  // fastify's own client errors (bad content-type, malformed json, payload
  // too large) carry a 4xx statusCode — pass them through instead of
  // masking them as 500s
  const statusCode = (err as FastifyError).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return reply
      .status(statusCode)
      .send({ code: (err as FastifyError).code ?? 'BAD_REQUEST', message: err.message });
  }
  req.log.error(err);
  return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong' });
}
