import crypto from 'node:crypto';
import env from '../config/env.js';

/**
 * ICE servers for a user, using the coturn "TURN REST API" scheme (use-auth-secret):
 *   username   = "<unix-expiry>:<userId>"
 *   credential = base64(HMAC-SHA1(TURN_SECRET, username))
 * coturn validates these with the same static-auth-secret; the secret never leaves the server.
 */
export function getIceServers(userId) {
  const servers = [];
  if (env.STUN_URLS.length) servers.push({ urls: env.STUN_URLS });
  if (env.TURN_URLS.length && env.TURN_SECRET) {
    const expiry = Math.floor(Date.now() / 1000) + env.TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiry}:${userId}`;
    const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: env.TURN_URLS, username, credential });
  }
  return { iceServers: servers, ttlSeconds: env.TURN_CREDENTIAL_TTL_SECONDS };
}
