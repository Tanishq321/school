// Test environment. Requires a MongoDB-compatible server (TEST_MONGODB_URI, default localhost:27017).
process.env.ENV_FILE = '/nonexistent-env-file';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'silent';
process.env.APP_URL = 'http://localhost:5173';
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || `mongodb://127.0.0.1:27017/vp_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789';
process.env.MEETING_TOKEN_SECRET = 'test-meeting-secret-0123456789abcdef012345678';
process.env.INVITE_SECRET = 'test-invite-secret-0123456789abcdef0123456789';
process.env.TURN_SECRET = 'test-turn-secret-0123456789abcdef0123456789ab';
process.env.TURN_URLS = 'turn:turn.example.test:3478?transport=udp,turn:turn.example.test:3478?transport=tcp';
process.env.STUN_URLS = 'stun:turn.example.test:3478';
process.env.BCRYPT_ROUNDS = '10';
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.RECONNECT_GRACE_SECONDS = '1';
