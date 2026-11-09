import AuditLog from '../models/AuditLog.js';
import logger from '../utils/logger.js';

/** Fire-and-forget audit entry. Never throws into the request path. */
export function audit(action, { actor, targetType, targetId, ip, meta } = {}) {
  AuditLog.create({ action, actor, targetType, targetId: targetId && String(targetId), ip, meta }).catch((err) =>
    logger.error({ err, action }, 'Failed to write audit log'),
  );
}
