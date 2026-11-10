import { Router } from 'express';
import { z } from 'zod';
import * as admin from '../services/adminService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const id = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id') });
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const ctx = (req) => ({ ip: req.ip });

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', async (_req, res) => res.json(await admin.overview()));

router.get(
  '/users',
  validate({ query: z.object({ q: z.string().trim().max(80).optional(), role: z.enum(['teacher', 'student', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional(), page }) }),
  async (req, res) => res.json(await admin.listUsers(req.valid.query)),
);
router.patch(
  '/users/:id',
  validate({
    params: id,
    body: z
      .object({ status: z.enum(['active', 'suspended']).optional(), role: z.enum(['teacher', 'student', 'admin']).optional(), unlock: z.literal(true).optional() })
      .strict()
      .refine((b) => Object.keys(b).length, 'Nothing to change'),
  }),
  async (req, res) => res.json({ user: await admin.updateUser(req.user, req.valid.params.id, req.valid.body, ctx(req)) }),
);
router.post('/users/:id/sign-out', validate({ params: id }), async (req, res) => {
  await admin.forceSignOut(req.user, req.valid.params.id, ctx(req));
  res.status(204).end();
});

router.get(
  '/classes',
  validate({ query: z.object({ status: z.enum(['scheduled', 'live', 'ended', 'cancelled', 'expired']).optional(), page }) }),
  async (req, res) => res.json(await admin.listClasses(req.valid.query)),
);
router.post('/classes/:id/end', validate({ params: id }), async (req, res) => {
  await admin.endClass(req.user, req.valid.params.id, ctx(req));
  res.status(204).end();
});

router.get(
  '/audit',
  validate({
    query: z.object({
      action: z.string().trim().max(60).regex(/^[a-z0-9_.]*$/i).optional(),
      actor: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      page,
    }),
  }),
  async (req, res) => res.json(await admin.listAudit(req.valid.query)),
);

export default router;
