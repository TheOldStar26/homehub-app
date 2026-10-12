import { dueReminders, DEFAULTS, normalisePreferences } from './model.js';

async function rows(query) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query().range(offset, offset + 499);
    if (error) throw error;
    result.push(...data);
    if (data.length < 500) return result;
  }
}

// The database primary key claims each reminder before delivery, including
// overlapping cron invocations. Failed sends release the claim for retry.
export async function deliverReminders(db, push, now = new Date()) {
  const subscriptions = await rows(() => db.from('push_subscriptions').select('*').order('id'));
  const end = now.toISOString(), start = new Date(now.getTime() - 6 * 60000).toISOString();
  const counts = { delivered: 0, duplicates: 0, errors: 0, expired: 0, failures: [] };
  const owners = new Map();
  for (const sub of subscriptions) {
    if (!owners.has(sub.user_id)) {
      const { data: pref, error } = await db.from('notification_preferences').select('enabled,categories').eq('user_id', sub.user_id).maybeSingle();
      if (error) throw error;
      let reminders = [];
      if (pref?.enabled) {
        const events = await rows(() => db.from('calendar_events').select('*').eq('user_id', sub.user_id).order('id'));
        reminders = dueReminders(events, normalisePreferences(pref.categories || DEFAULTS), start, end);
      }
      owners.set(sub.user_id, reminders);
    }
    for (const item of owners.get(sub.user_id)) {
      // Editing a title must not resend a reminder already sent at this instant.
      const key = `${sub.id}:${item.occurrence.key}:${item.sendAt}`;
      const { error: claim } = await db.from('homehub_notification_deliveries').insert({ reminder_key: key, user_id: sub.user_id });
      if (claim?.code === '23505') { counts.duplicates++; continue; }
      if (claim) {
        counts.errors++;
        if (counts.failures.length < 5) counts.failures.push({ stage: 'claim', code: /^[A-Z0-9]{5,12}$/.test(claim.code) ? claim.code : 'UNKNOWN' });
        continue;
      }
      try {
        await push.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({
          title: 'HomeHub reminder', body: item.event.title, eventId: item.event.id,
          date: item.occurrence.occurrence_date, tag: key,
        }), { TTL: 3600, timeout: 10000 });
        counts.delivered++;
      } catch (error) {
        counts.errors++;
        // Never log push endpoints, encryption keys, event titles or responses.
        const failure = {
          status: Number.isInteger(error?.statusCode) ? error.statusCode : null,
          reason: /^[A-Za-z]{1,60}$/.test(error?.providerReason) ? error.providerReason : null,
          message: String(error?.message || 'Push delivery failed').replace(/https?:\/\/\S+|[A-Za-z0-9_\-=]{20,}/g, '[redacted]').slice(0, 180),
        };
        if (counts.failures.length < 5) counts.failures.push(failure);
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          counts.expired++;
          await db.from('push_subscriptions').delete().eq('id', sub.id);
          break;
        }
        const { error: release } = await db.from('homehub_notification_deliveries').delete().eq('reminder_key', key);
        if (release) throw release;
      }
    }
  }
  return counts;
}
