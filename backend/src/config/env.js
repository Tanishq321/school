import { z } from 'zod';

// Load .env if present (Node >= 20.12 built-in, no dotenv dependency).
try {
  process.loadEnvFile(process.env.ENV_FILE || '.env');
} catch {
  /* no .env file: rely on real environment */
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Render sets RENDER_EXTERNAL_URL automatically (https://<service>.onrender.com).
  APP_URL: z.url().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  CORS_ORIGINS: csv,
  SERVE_FRONTEND_DIST: z.string().optional(),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  MEETING_TOKEN_SECRET: z.string().min(32),
  INVITE_SECRET: z.string().min(32),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  REQUIRE_EMAIL_VERIFICATION: bool.default(true),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Classroom <no-reply@localhost>'),

  STUN_URLS: csv,
  TURN_URLS: csv,
  TURN_SECRET: z.string().min(32).optional(),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(10800),

  P2P_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(4).default(2),

  // ---- mediasoup SFU (Phase 2). Needs UDP/TCP ports reachable from browsers (not possible on Render).
  MEDIASOUP_ENABLED: bool.default(false),
  MEDIASOUP_NUM_WORKERS: z.coerce.number().int().min(1).max(64).optional(), // default: CPU cores
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  // Public IP or hostname browsers use to reach the SFU (required unless listening on a public IP).
  MEDIASOUP_ANNOUNCED_ADDRESS: z.string().optional(),
  // Each worker gets ONE port (UDP+TCP) via WebRtcServer: PORT_BASE .. PORT_BASE+workers-1.
  MEDIASOUP_PORT_BASE: z.coerce.number().int().min(1024).max(65000).default(40000),
  MEDIASOUP_MAX_ROOMS_PER_WORKER: z.coerce.number().int().min(1).default(50),
  MEDIASOUP_MAX_INCOMING_BITRATE: z.coerce.number().int().min(100_000).default(1_500_000),
  SFU_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(100).default(20),
  RECONNECT_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(20),
  MEETING_IDLE_END_MINUTES: z.coerce.number().int().min(1).default(15),
  MEETING_EXPIRY_GRACE_MINUTES: z.coerce.number().int().min(0).default(60),

  // Set false only for test/staging hosts (e.g. Render free tier without SMTP/TURN): problems become warnings.
  STRICT_PRODUCTION_CHECKS: bool.default(true),
  // Multiplies all rate limits. Raise it when many users share one IP as seen by the API (e.g. behind a proxying CDN).
  RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(100).default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  const problems = [];
  if (!env.SMTP_HOST) problems.push('SMTP_HOST is required in production (verification & reset emails).');
  if (env.TURN_URLS.length && !env.TURN_SECRET) problems.push('TURN_SECRET is required when TURN_URLS is set.');
  if (!env.TURN_URLS.length) problems.push('TURN_URLS is empty: users behind strict NATs will not connect.');
  if (!env.APP_URL.startsWith('https://')) problems.push('APP_URL must be https in production.');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`Production configuration ${env.STRICT_PRODUCTION_CHECKS ? 'problems' : 'warnings (STRICT_PRODUCTION_CHECKS=false)'}:\n- ` + problems.join('\n- '));
    if (env.STRICT_PRODUCTION_CHECKS) process.exit(1);
  }
}

env.corsOrigins = env.CORS_ORIGINS.length ? env.CORS_ORIGINS : [new URL(env.APP_URL).origin];
env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';

export default env;
