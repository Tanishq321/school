import mongoose from 'mongoose';

/**
 * One-time claims for background work shared by several API processes ("send this reminder").
 * The unique key is the lock: the first insert wins, every later one fails with a duplicate key.
 * Old claims are pruned by the jobs themselves (`pruneClaims`), not a TTL index, so this works on
 * MongoDB-compatible servers without TTL support too.
 */
const jobClaimSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  at: { type: Date, default: Date.now, index: true },
});

const JobClaim = mongoose.model('JobClaim', jobClaimSchema);

/** true if this process won the claim. */
export async function claim(key) {
  try {
    await JobClaim.create({ key });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

export const pruneClaims = (olderThanDays = 30) => JobClaim.deleteMany({ at: { $lt: new Date(Date.now() - olderThanDays * 86_400_000) } });

export default JobClaim;
