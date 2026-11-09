import { rateLimit } from 'express-rate-limit';
import env from '../config/env.js';

const common = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({ error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } }),
};

// Limits are relaxed in the test environment so automated tests can run many flows quickly.
const scale = env.isTest ? 100 : env.RATE_LIMIT_MULTIPLIER;

export const globalLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 300 * scale });

export const authLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 20 * scale });

export const emailLimiter = rateLimit({ ...common, windowMs: 60 * 60_000, limit: 5 * scale });

/** Per-user limit on meeting lookups/joins: blocks meeting-code and password guessing. */
export const meetingLookupLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60_000,
  limit: 40 * scale,
  keyGenerator: (req) => `u:${req.user?.id}`,
});
