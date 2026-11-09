import mongoose from 'mongoose';
import { AppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'bad_id', message: 'Invalid identifier' } });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'duplicate', message: 'Already exists' } });
  }
  (req.log || logger).error({ err }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
