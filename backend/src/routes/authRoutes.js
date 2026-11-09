import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, emailLimiter } from '../middleware/rateLimits.js';

const email = z.email('Enter a valid email address').max(254).transform((v) => v.trim().toLowerCase());
// bcrypt only uses the first 72 bytes, so cap there rather than silently truncating.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long (max 72 bytes)')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');
const name = z.string().trim().min(1, 'Name is required').max(80);
const profile = z
  .object({
    bio: z.string().max(1000).optional(),
    subjects: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    gradeLevel: z.string().max(50).optional(),
  })
  .strict();
const token = z.string().min(10).max(200);

const router = Router();

router.post(
  '/register',
  authLimiter,
  validate({ body: z.object({ name, email, password, role: z.enum(['teacher', 'student']), profile: profile.optional() }) }),
  c.register,
);
router.post('/login', authLimiter, validate({ body: z.object({ email, password: z.string().min(1).max(200) }) }), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.post('/verify-email', authLimiter, validate({ body: z.object({ token }) }), c.verifyEmail);
router.post('/resend-verification', requireAuth, emailLimiter, c.resendVerification);
router.post('/forgot-password', emailLimiter, validate({ body: z.object({ email }) }), c.forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: z.object({ token, password }) }), c.resetPassword);
router.get('/me', requireAuth, c.me);
router.patch('/me', requireAuth, validate({ body: z.object({ name: name.optional(), profile: profile.optional() }) }), c.updateProfile);

export default router;
