import type { AppMiddleware } from '../auth/context';
import { clientIp, rateLimited } from './http';

type LimiterName = 'AUTH_RATE_LIMITER' | 'SEND_RATE_LIMITER' | 'SEARCH_RATE_LIMITER' | 'WEBHOOK_RATE_LIMITER';

/**
 * Applies a Workers Rate Limiting binding keyed by user (when signed in) or IP.
 * Missing bindings (e.g. in unit tests) fail open.
 */
export function rateLimit(name: LimiterName, keyBy: 'ip' | 'user' = 'ip'): AppMiddleware {
  return async (c, next) => {
    const limiter = c.env[name] as RateLimit | undefined;
    if (limiter && typeof limiter.limit === 'function') {
      const user = c.var.principal?.user;
      const key = keyBy === 'user' && user ? `u:${user.id}` : `ip:${clientIp(c)}`;
      const { success } = await limiter.limit({ key: `${name}:${key}` });
      if (!success) throw rateLimited();
    }
    return next();
  };
}
