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

// One-to-one classes: at most one invited student.
const invitees = z.array(z.email('Enter a valid email address').max(254)).max(1, 'A class has one student: invite one email address');

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
    allowScreenShare: z.boolean().optional(),
    allowDrawing: z.boolean().optional(),
    chatMode: z.enum(['everyone', 'host']).optional(),
    saveChat: z.boolean().optional(),
    invitees: invitees.optional(),
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
    allowScreenShare: z.boolean().optional(),
    allowDrawing: z.boolean().optional(),
    chatMode: z.enum(['everyone', 'host']).optional(),
    saveChat: z.boolean().optional(),
    rotateInvite: z.boolean().optional(),
    invitees: invitees.optional(),
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

const listQuery = z
  .object({
    scope: z.enum(['upcoming', 'past', 'range']).default('upcoming'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((q) => q.scope !== 'range' || (q.from && q.to && q.to > q.from && q.to - q.from <= 62 * 86_400_000), {
    message: 'A calendar range needs from < to, at most 62 days apart',
  });

router.get('/', validate({ query: listQuery }), c.list);
router.post('/', requireVerifiedEmail, requireRole('teacher', 'admin'), validate({ body: createBody }), c.create);
router.get('/:code', meetingLookupLimiter, validate({ params: codeParams }), c.get);
router.patch('/:code', validate({ params: codeParams, body: updateBody }), c.update);
router.delete('/:code', validate({ params: codeParams }), c.cancel);
router.post('/:code/join', requireVerifiedEmail, meetingLookupLimiter, validate({ params: codeParams, body: joinBody }), c.join);
router.post('/:code/leave', validate({ params: codeParams }), c.leave);
router.post('/:code/end', validate({ params: codeParams }), c.end);
router.get('/:code/participants', validate({ params: codeParams }), c.participants);
router.get('/:code/attendance', validate({ params: codeParams }), c.attendanceReport);
router.get('/:code/summary', validate({ params: codeParams }), c.summary);
router.get('/:code/calendar.ics', validate({ params: codeParams }), c.ics);
router.put('/:code/notes', validate({ params: codeParams, body: z.object({ notes: z.string().max(20000) }).strict() }), c.saveNotes);

export default router;

export const diagnosticsRouter = Router().get('/ice', requireAuth, c.iceForDiagnostics);
