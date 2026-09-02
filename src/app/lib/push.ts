import { del, post } from './api';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'navigate' && typeof event.data.url === 'string') {
        window.history.pushState({}, '', event.data.url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
    return registration;
  } catch (error) {
    console.warn('service worker registration failed', error);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function subscribeToPush(publicKey: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) return false;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  const json = subscription.toJSON();
  await post('/api/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await del('/api/push/subscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
