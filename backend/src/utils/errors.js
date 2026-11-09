export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine-readable code, e.g. "meeting_full"
   * @param {string} message human-readable message safe to show users
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg = 'Invalid request', details) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Authentication required', code = 'unauthorized') => new AppError(401, code, msg);
export const forbidden = (msg = 'You do not have permission to do that', code = 'forbidden') =>
  new AppError(403, code, msg);
export const notFound = (msg = 'Not found', code = 'not_found') => new AppError(404, code, msg);
export const conflict = (msg, code = 'conflict') => new AppError(409, code, msg);
