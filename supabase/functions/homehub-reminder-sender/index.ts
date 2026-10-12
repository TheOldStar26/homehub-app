import webpush from 'npm:web-push@3.6.7';
import { createECDH } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { deliverReminders } from './delivery.js';
import { pushTransport } from './transport.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = req.headers.get('x-homehub-scheduler');
  if (!token || token.length > 128) return json({ error: 'Unauthorized' }, 401);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: authorized, error } = await db.rpc('homehub_scheduler_authorized', { candidate: token });
    if (error) return json({ error: 'Scheduler authentication unavailable' }, 503);
    if (!authorized) return json({ error: 'Unauthorized' }, 401);
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!privateKey) return json({ error: 'Push is not configured' }, 503);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    const publicKey = ecdh.getPublicKey().toString('base64url');
    const body = await req.json().catch(() => ({}));
    if (body.action === 'health') return json({ ok: true, publicKeyMatches: publicKey === body.expectedPublicKey });
    webpush.setVapidDetails('mailto:admin@theoldstar26.github.io', publicKey, privateKey);
    const counts = await deliverReminders(db, pushTransport(webpush));
    return json({ ok: counts.errors === 0, ...counts });
  } catch {
    return json({ error: 'Reminder processing failed' }, 500);
  }
});
