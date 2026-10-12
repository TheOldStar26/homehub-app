export const ORIGIN = 'https://theoldstar26.github.io';
export const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Vary': 'Origin',
};
export function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'web.push.apple.com' || u.hostname === 'fcm.googleapis.com' ||
       u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
function validKey(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  try { const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return raw.length === length && (length !== 65 || raw.charCodeAt(0) === 4); }
  catch { return false; }
}
export function validSubscription(sub) {
  return validEndpoint(sub?.endpoint) && validKey(sub?.keys?.p256dh, 65) && validKey(sub?.keys?.auth, 16);
}
