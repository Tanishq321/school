import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { roster, stats } from '../services/insightsService.js';
import { notFound } from '../utils/errors.js';

/** Teachers: their students. */
export const studentsRouter = Router()
  .use(requireAuth, requireRole('teacher', 'admin'))
  .get('/', async (req, res) => res.json({ students: await roster(req.user) }))
  .get('/:email', validate({ params: z.object({ email: z.email().max(254).transform((e) => e.toLowerCase()) }) }), async (req, res) => {
    const [student] = await roster(req.user, { email: req.valid.params.email });
    if (!student) throw notFound('No classes with this student', 'student_not_found');
    res.json({ student });
  });

const period = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((q) => q.to > q.from && q.to - q.from <= 62 * 86_400_000, { message: 'A period needs from < to, at most 62 days apart' });

/** Everyone: their own figures for a period. */
export const meRouter = Router()
  .use(requireAuth)
  .get('/stats', validate({ query: period }), async (req, res) => res.json(await stats(req.user, req.valid.query)));
