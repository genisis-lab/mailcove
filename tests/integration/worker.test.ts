import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports.default;

describe('Worker HTTP surface', () => {
  it('serves /health', async () => {
    const response = await worker.fetch(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('mailcove');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('exposes public /api/config and setup status', async () => {
    const config = await worker.fetch(new Request('http://localhost/api/config'));
    expect(config.status).toBe(200);
    const cfg = (await config.json()) as { appName: string; needsSetup: boolean; hasUsers: boolean };
    expect(cfg.appName).toBeTruthy();
    expect(cfg.hasUsers).toBe(false);
    expect(cfg.needsSetup).toBe(true);

    const status = await worker.fetch(new Request('http://localhost/api/setup/status'));
    expect(status.status).toBe(200);
    const body = (await status.json()) as { hasAdmin: boolean; providers: Record<string, { configured: boolean }> };
    expect(body.hasAdmin).toBe(false);
    expect(body.providers.cloudflare).toBeTruthy();
  });

  it('does not fall through unknown API routes to the SPA', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/does-not-exist'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('blocks cross-origin state-changing requests', async () => {
    const bad = await worker.fetch(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: '{}',
      }),
    );
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('bad_origin');
  });

  it('rejects WebSocket upgrades without a session', async () => {
    const response = await worker.fetch(
      new Request('http://localhost/ws', { headers: { upgrade: 'websocket' } }),
    );
    expect(response.status).toBe(401);
  });

  it('describes the public v1 surface', async () => {
    const response = await worker.fetch(new Request('http://localhost/api/v1'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; version: number };
    expect(body.name).toBe('Mailcove API');
    expect(body.version).toBe(1);
  });

  it('creates an admin and signs in with a password in the Worker runtime', async () => {
    const base = 'http://localhost:5173';
    const credentials = { email: 'admin@example.test', password: 'staging-integration-password' };
    const signup = await worker.fetch(new Request(`${base}/api/setup/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ ...credentials, name: 'Test Admin' }),
    }));
    expect(signup.status, await signup.text()).toBe(200);
    const signin = await worker.fetch(new Request(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify(credentials),
    }));
    expect(signin.status, await signin.clone().text()).toBe(200);
    expect(signin.headers.get('set-cookie')).toBeTruthy();
    const body = await signin.json() as { user: { email: string; role: string } };
    expect(body.user.email).toBe(credentials.email);
    expect(body.user.role).toBe('admin');
  });
});
