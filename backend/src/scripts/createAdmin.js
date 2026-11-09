// Usage: ADMIN_EMAIL=a@b.c ADMIN_PASSWORD='...' ADMIN_NAME='Admin' npm run create-admin
import { connectDb, disconnectDb } from '../config/db.js';
import User from '../models/User.js';
import { hashPassword } from '../services/authService.js';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Administrator' } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars).');
  process.exit(1);
}
await connectDb();
const email = ADMIN_EMAIL.trim().toLowerCase();
const passwordHash = await hashPassword(ADMIN_PASSWORD);
await User.updateOne(
  { email },
  { $set: { name: ADMIN_NAME, role: 'admin', passwordHash, emailVerified: true, status: 'active' } },
  { upsert: true },
);
console.log(`Admin account ready: ${email}`);
await disconnectDb();
