import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import mongoose from 'mongoose';
import env from './config/env.js';
import logger from './utils/logger.js';
import authRoutes from './routes/authRoutes.js';
import meetingRoutes, { diagnosticsRouter } from './routes/meetingRoutes.js';
import recordingRoutes from './routes/recordingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { httpMetrics, renderPrometheus } from './services/metrics.js';
import { getIo } from './sockets/realtime.js';
import { safeEqual } from './utils/crypto.js';
import { globalLimiter } from './middleware/rateLimits.js';
import { workerPool } from './mediasoup/workerPool.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  const turnHosts = env.TURN_URLS.map((u) => u.replace(/^turns?:/, '').split(/[:?]/)[0]);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", ...env.corsOrigins, ...env.corsOrigins.map((o) => o.replace(/^http/, 'ws'))],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          // Only force https upgrades in production (dev/E2E serve over plain http://localhost).
          'upgrade-insecure-requests': env.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_req, res, next) => {
    // Camera/mic/screen only for our own origin.
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    next();
  });
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(httpMetrics);
  // Prometheus scrape endpoint: off unless METRICS_TOKEN is set; never public.
  app.get('/metrics', (req, res) => {
    const given = (req.get('authorization') || '').replace(/^Bearer /, '');
    if (!env.METRICS_TOKEN || !safeEqual(given, env.METRICS_TOKEN)) return res.status(404).end();
    res.type('text/plain; version=0.0.4').send(renderPrometheus(getIo()));
    return undefined;
  });
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    const workers = workerPool.status();
    const sfuDown = workerPool.enabled && !workers.some((w) => !w.closed);
    res.status(dbUp && !sfuDown ? 200 : 503).json({
      status: dbUp && !sfuDown ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      mediaMode: workerPool.ready ? 'sfu' : 'p2p',
      mediasoupWorkers: workers.length,
      uptime: Math.round(process.uptime()),
      turnConfigured: turnHosts.length > 0,
    });
  });

  // Public, non-sensitive client configuration.
  app.get('/api/config', (_req, res) => {
    res.json({
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
      mediaMode: workerPool.ready ? 'sfu' : 'p2p',
      classSize: 2, // one teacher, one student
      appName: env.APP_NAME,
      recording: { enabled: env.RECORDING_ENABLED && workerPool.ready, retentionDays: env.RECORDING_RETENTION_DAYS, maxMinutes: env.RECORDING_MAX_MINUTES },
    });
  });

  app.use('/api', globalLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/recordings', recordingRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/diagnostics', diagnosticsRouter);
  app.use('/api', notFoundHandler);

  // Optional: serve the built frontend from the same origin (small deployments / E2E tests).
  if (env.SERVE_FRONTEND_DIST) {
    const dist = path.resolve(env.SERVE_FRONTEND_DIST);
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      logger.warn({ dist }, 'SERVE_FRONTEND_DIST set but index.html not found');
    }
  }

  app.use(errorHandler);
  return app;
}
