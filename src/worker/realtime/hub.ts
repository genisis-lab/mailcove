import { DurableObject } from 'cloudflare:workers';
import type { RealtimeEvent } from '../../shared/types';
import type { AppEnv } from '../env';

/**
 * One MailHub per user. Browser tabs connect over WebSocket (hibernation API,
 * so idle connections cost nothing); the ingest pipeline pushes events here.
 */
export class MailHub extends DurableObject<AppEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'hello', connections: this.ctx.getWebSockets().length }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC entry point used by the Worker to fan an event out to every open tab. */
  async broadcast(event: RealtimeEvent): Promise<number> {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        try {
          ws.close(1011, 'send failed');
        } catch {
          // already closed
        }
      }
    }
    return delivered;
  }

  async connections(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping' || message === '{"type":"ping"}') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void wasClean;
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // ignore
    }
  }
}

export async function publishToUser(env: AppEnv, userId: string, event: RealtimeEvent): Promise<void> {
  try {
    const stub = env.MAIL_HUB.getByName(userId) as unknown as { broadcast(event: RealtimeEvent): Promise<number> };
    await stub.broadcast(event);
  } catch (error) {
    console.warn('realtime publish failed', error);
  }
}

export async function publishToUsers(env: AppEnv, userIds: Iterable<string>, event: RealtimeEvent): Promise<void> {
  await Promise.all([...new Set(userIds)].map((id) => publishToUser(env, id, event)));
}
