/**
 * Push notification registration — called once after the user logs in.
 * Asks for permission, subscribes via PushManager, saves the subscription
 * object to Supabase so the Edge Function can target this device.
 * Also sends Supabase credentials to the service worker so "Confirm"
 * actions can write directly to the cloud without opening the app.
 */
import { supabase, isConfigured } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function registerPush(): Promise<'granted' | 'denied' | 'unavailable' | 'not-configured'> {
  if (!isConfigured())                               return 'not-configured';
  if (!VAPID_PUBLIC_KEY)                             return 'not-configured';
  if (!('serviceWorker' in navigator))               return 'unavailable';
  if (!('PushManager' in window))                    return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted')                      return 'denied';

  try {
    const reg = await navigator.serviceWorker.ready;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });

    // Save subscription to Supabase so Edge Function can send pushes
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('push_subscriptions').upsert(
        { user_id: user.id, subscription: JSON.stringify(sub), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    }

    // Give service worker Supabase creds for one-tap confirm actions
    await sendConfigToSW();

    return 'granted';
  } catch (err) {
    console.error('[push] registration failed', err);
    return 'unavailable';
  }
}

/** Re-send Supabase config to SW on every app start (token refreshes). */
export async function sendConfigToSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const worker = reg.active;
  if (!worker) return;

  const { data: { session } } = await supabase.auth.getSession();
  worker.postMessage({
    type:  'SUPABASE_CONFIG',
    url:   import.meta.env.VITE_SUPABASE_URL  ?? '',
    key:   import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    token: session?.access_token ?? '',
  });
}

export async function getPushStatus(): Promise<'granted' | 'denied' | 'default' | 'unavailable'> {
  if (!('Notification' in window)) return 'unavailable';
  return Notification.permission as 'granted' | 'denied' | 'default';
}
