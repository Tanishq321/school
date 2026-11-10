import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/meetingController.js';
import { requireAuth, requireRole, requireVerifiedEmail } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { meetingLookupLimiter } from '../middleware/rateLimits.js';
import { normalizeMeetingCode } from '../utils/crypto.js';

const codeParams = z.object({
  code: z
    .string()
    .max(40)
    .transform((v, ctx) => {
      const code = normalizeMeetingCode(v);
      if (!code) {
        ctx.addIssue({ code: 'custom', message: 'Invalid meeting code' });
        return z.NEVER;
      }
      return code;
    }),
});

const meetingPassword = z.string().min(4, 'Meeting password must be at least 4 characters').max(64);

const createBody = z
  .object({
    type: z.enum(['instant', 'scheduled']),
    title: z.string().trim().max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    scheduledStart: z.coerce.date().optional(),
    durationMinutes: z.number().int().min(5).max(600).optional(),
    password: meetingPassword.optional(),
    waitingRoom: z.boolean().optional(),
    maxParticipants: z.number().int().min(2).max(100).optional(),
    allowSelfUnmute: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.type === 'instant' || b.scheduledStart, { message: 'scheduledStart is required for scheduled meetings', path: ['scheduledStart'] });

const updateBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    scheduledStart: z.coerce.date().optional(),
    durationMinutes: z.number().int().min(5).max(600).optional(),
    password: meetingPassword.nullable().optional(),
    waitingRoom: z.boolean().optional(),
    maxParticipants: z.number().int().min(2).max(100).optional(),
    allowSelfUnmute: z.boolean().optional(),
    rotateInvite: z.boolean().optional(),
  })
  .strict();

const joinBody = z
  .object({
    password: z.string().max(64).optional(),
    invite: z.string().max(64).optional(),
  })
  .strict();

const router = Router();
router.use(requireAuth);

router.get('/', validate({ query: z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }) }), c.list);
router.post('/', requireVerifiedEmail, requireRole('teacher', 'admin'), validate({ body: createBody }), c.create);
router.get('/:code', meetingLookupLimiter, validate({ params: codeParams }), c.get);
router.patch('/:code', validate({ params: codeParams, body: updateBody }), c.update);
router.delete('/:code', validate({ params: codeParams }), c.cancel);
router.post('/:code/join', requireVerifiedEmail, meetingLookupLimiter, validate({ params: codeParams, body: joinBody }), c.join);
router.post('/:code/leave', validate({ params: codeParams }), c.leave);
router.post('/:code/end', validate({ params: codeParams }), c.end);
router.get('/:code/participants', validate({ params: codeParams }), c.participants);
router.get('/:code/attendance', validate({ params: codeParams }), c.attendanceReport);

export default router;

export const diagnosticsRouter = Router().get('/ice', requireAuth, c.iceForDiagnostics);
