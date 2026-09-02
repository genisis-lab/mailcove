import { Hono } from 'hono';
import { createAuth } from './auth/auth';
import { resolvePrincipal, type AppVariables } from './auth/context';
import { createDb } from './db/client';
import type { AppEnv } from './env';
import { newId } from './lib/crypto';
import { errorResponse, HttpError } from './lib/http';
import { rateLimit } from './lib/rate-limit';
import { originCheck, securityHeaders } from './lib/security';
import { getSetting } from './lib/settings';
import { adminRoutes } from './routes/admin';
import { blockedRoutes, contactRoutes, templateRoutes } from './routes/contacts';
import { filterRoutes } from './routes/filters';
import { importExportRoutes } from './routes/import-export';
import { inboundWebhookRoutes } from './routes/inbound-webhooks';
import { apiKeyRoutes, outgoingWebhookRoutes, pushRoutes } from './routes/integrations';
import { labelRoutes } from './routes/labels';
import { mailboxRoutes } from './routes/mailboxes';
import { meRoutes } from './routes/me';
import { draftRoutes, messageRoutes, uploadRoutes } from './routes/messages';
import { setupRoutes } from './routes/setup';
import { threadRoutes } from './routes/threads';
import { v1Routes } from './routes/v1';

export type AppBindings = { Bindings: AppEnv; Variables: AppVariables };

export function createApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.onError((error, c) => errorResponse(c, error));

  app.use('*', async (c, next) => {
    const db = createDb(c.env.DB);
    c.set('env', c.env);
    c.set('db', db);
    c.set('auth', createAuth(c.env, db));
    c.set('requestId', newId());
    c.set('principal', null);
    await next();
  });
  app.use('*', securityHeaders);

  app.get('/health', (c) => c.json({ ok: true, service: 'mailcove', time: new Date().toISOString() }));

  // Provider webhooks authenticate themselves (signatures/tokens); no session or origin checks.
  app.route('/api/webhooks', inboundWebhookRoutes);

  // better-auth: sign-in/up, sessions, 2FA, password changes.
  app.use('/api/auth/sign-in/*', rateLimit('AUTH_RATE_LIMITER'));
  app.use('/api/auth/sign-up/*', rateLimit('AUTH_RATE_LIMITER'));
  app.use('/api/auth/two-factor/*', rateLimit('AUTH_RATE_LIMITER'));
  app.use('/api/auth/change-password', rateLimit('AUTH_RATE_LIMITER'));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => c.var.auth.handler(c.req.raw));

  app.use('/api/*', originCheck);
  app.use('/api/*', resolvePrincipal);
  app.use('/api/*', async (c, next) => {
    if (c.var.principal?.kind === 'api_key' && !(await getSetting(c.var.db, 'publicApiEnabled'))) {
      throw new HttpError(403, 'api_disabled', 'The public API is disabled by an administrator.');
    }
    await next();
  });

  app.route('/api', setupRoutes);
  app.route('/api/me', meRoutes);
  app.route('/api/mailboxes', mailboxRoutes);
  app.route('/api/threads', threadRoutes);
  app.route('/api/messages', messageRoutes);
  app.route('/api/drafts', draftRoutes);
  app.route('/api/uploads', uploadRoutes);
  app.route('/api/labels', labelRoutes);
  app.route('/api/filters', filterRoutes);
  app.route('/api/contacts', contactRoutes);
  app.route('/api/blocked', blockedRoutes);
  app.route('/api/templates', templateRoutes);
  app.route('/api/api-keys', apiKeyRoutes);
  app.route('/api/outgoing-webhooks', outgoingWebhookRoutes);
  app.route('/api/push', pushRoutes);
  app.route('/api', importExportRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/v1', v1Routes);

  // Realtime: one WebSocket per tab, multiplexed through the user's MailHub.
  app.get('/ws', async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.text('Expected WebSocket', 426);
    let userId: string;
    try {
      const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
      if (!session?.user) return c.text('Unauthorized', 401);
      userId = session.user.id;
    } catch {
      return c.text('Unauthorized', 401);
    }
    const stub = c.env.MAIL_HUB.getByName(userId);
    return stub.fetch(c.req.raw);
  });

  app.notFound(async (c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path === '/ws') {
      return c.json({ error: { code: 'not_found', message: `No route for ${c.req.method} ${path}` } }, 404);
    }
    // SPA fallback for deep links when the request reached the Worker.
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text('Not found', 404);
  });

  return app;
}
