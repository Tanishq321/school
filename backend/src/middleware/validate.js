import { badRequest } from '../utils/errors.js';

/** Validates req.body / req.query / req.params with zod; results go to req.valid (Express 5 query is read-only). */
export const validate =
  ({ body, query, params } = {}) =>
  (req, _res, next) => {
    req.valid = {};
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        throw badRequest(issues[0]?.message ? `${issues[0].path ? issues[0].path + ': ' : ''}${issues[0].message}` : 'Invalid request', issues);
      }
      req.valid[key] = result.data;
    }
    next();
  };
