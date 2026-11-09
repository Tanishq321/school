import pino from 'pino';
import env from '../config/env.js';

const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.joinToken',
      '*.credential',
    ],
    censor: '[redacted]',
  },
});

export default logger;
