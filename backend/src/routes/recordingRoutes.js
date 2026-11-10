import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/recordingController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const idParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid recording id') });
const tokenQuery = z.object({ token: z.string().min(20).max(2000), download: z.enum(['1']).optional() });

const router = Router();

// Token-authenticated (signed URL) media endpoints come first: they carry no bearer header.
router.get('/:id/media', validate({ params: idParams, query: tokenQuery }), c.media);
router.head('/:id/media', validate({ params: idParams, query: tokenQuery }), c.media);
router.get('/:id/poster', validate({ params: idParams, query: tokenQuery }), c.poster);

router.use(requireAuth);
router.get('/', c.list);
router.get('/:id', validate({ params: idParams }), c.get);
router.patch(
  '/:id',
  validate({
    params: idParams,
    body: z
      .object({ title: z.string().trim().min(1).max(160).optional(), shareWithParticipants: z.boolean().optional() })
      .strict()
      .refine((b) => Object.keys(b).length, 'Nothing to change'),
  }),
  c.update,
);
router.delete('/:id', validate({ params: idParams }), c.remove);
router.post('/:id/playback', validate({ params: idParams }), c.playback);

export default router;
