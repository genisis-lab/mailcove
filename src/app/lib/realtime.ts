import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeEvent } from '@shared/types';
import { keys } from './queries';

type Listener = (event: RealtimeEvent) => void;
const listeners = new Set<Listener>();

export function onRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Keeps one WebSocket to the user's MailHub open while signed in, invalidates
 * the affected queries when events arrive, and falls back to periodic polling
 * while disconnected.
 */
export function useRealtime(enabled: boolean): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let poller: ReturnType<typeof setInterval> | null = null;

    const invalidate = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'message.new':
        case 'thread.updated':
          void qc.invalidateQueries({ queryKey: ['threads'] });
          void qc.invalidateQueries({ queryKey: keys.counts });
          void qc.invalidateQueries({ queryKey: keys.thread(event.threadId) });
          break;
        case 'message.status':
          void qc.invalidateQueries({ queryKey: keys.thread(event.threadId) });
          void qc.invalidateQueries({ queryKey: ['threads'] });
          break;
        case 'counts.changed':
          void qc.invalidateQueries({ queryKey: keys.counts });
          break;
        default:
          break;
      }
      for (const l of listeners) l(event);
    };

    const startPolling = () => {
      if (poller) return;
      poller = setInterval(() => {
        void qc.invalidateQueries({ queryKey: ['threads'] });
        void qc.invalidateQueries({ queryKey: keys.counts });
      }, 60_000);
    };
    const stopPolling = () => {
      if (poller) clearInterval(poller);
      poller = null;
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      } catch {
        startPolling();
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        attempts.current = 0;
        setConnected(true);
        stopPolling();
        heartbeat = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25_000);
      };
      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as RealtimeEvent | { type: 'hello' };
          if (data.type === 'hello') return;
          invalidate(data as RealtimeEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        startPolling();
        scheduleReconnect();
      };
      socket.onerror = () => socket?.close();
    };

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts.current, 5));
      attempts.current += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!socket || socket.readyState === WebSocket.CLOSED)) connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat);
      stopPolling();
      socket?.close();
    };
  }, [enabled, qc]);

  return { connected };
}
