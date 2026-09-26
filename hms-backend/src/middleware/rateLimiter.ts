import rateLimit from 'express-rate-limit';
import { env } from '@/config/env';

/**
 * Global limiter (§7.11). In-memory store — sufficient for a single-instance
 * deployment; swap the `store` option for a Redis-backed store if the
 * backend is horizontally scaled (§13).
 */
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' } },
});

/** Stricter limiter for `/auth/login` to blunt credential-stuffing (§7.11). */
export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts, please try again later.' },
  },
});

/**
 * Same limits as login, but its own counter — wrong doctor discharge passwords
 * must not lock the Admission user out of their own portal login.
 */
export const clinicalAuthRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many doctor credential attempts, please try again later.' },
  },
});
