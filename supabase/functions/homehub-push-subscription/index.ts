import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { cors, ORIGIN, validSubscription, validEndpoint } from './validation.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.headers.get('origin') && req.headers.get('origin') !== ORIGIN) return json({ error: 'Origin not allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
    const { data: { user }, error } = await auth.auth.getUser(token);
    if (error || !user) return json({ error: 'Unauthorized' }, 401);
    const text = await req.text();
    if (text.length > 8192) return json({ error: 'Request too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    if (body.action === 'subscribe') {
      if (!validSubscription(body.subscription)) return json({ error: 'Invalid push subscription' }, 400);
      const { endpoint, keys } = body.subscription;
      const { data: existing, error: lookup } = await db.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).maybeSingle();
      if (lookup) throw lookup;
      if (existing && existing.user_id !== user.id) return json({ error: 'Device belongs to another account; disable its notifications first' }, 409);
      const row = { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth };
      const { error: save } = existing
        ? await db.from('push_subscriptions').update(row).eq('endpoint', endpoint).eq('user_id', user.id)
        : await db.from('push_subscriptions').insert(row);
      if (save?.code === '23505') return json({ error: 'Device registration changed; please try again' }, 409);
      if (save) throw save;
    } else if (body.action === 'unsubscribe') {
      if (!validEndpoint(body.endpoint)) return json({ error: 'Invalid push endpoint' }, 400);
      const { error: remove } = await db.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', body.endpoint);
      if (remove) throw remove;
    } else return json({ error: 'Unknown action' }, 400);
    return json({ ok: true });
  } catch { return json({ error: 'Push registration failed' }, 500); }
});
