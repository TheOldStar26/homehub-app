// Realtime is a refresh hint only: always re-read through owner-scoped REST/RLS.
// INSERT/UPDATE only. DELETE remains covered by 15s/focus/online polling.
// Our UI never consumes DELETE identifiers as evidence of ownership.
export function subscribeCalendar(client, owner, refresh, status = () => {}) {
    let closed = false, timer = null, running = false, again = false;
    if (!client?.channel || !client?.removeChannel) { status('polling'); return () => {}; }
    if (!/^[A-Za-z0-9_-]+$/.test(owner)) throw Error('Invalid calendar subscription owner.');
    const schedule = () => {
        if (closed) return;
        if (running) { again = true; return; }
        clearTimeout(timer);
        timer = setTimeout(async () => {
            timer = null; running = true;
            try { if (!closed) await refresh(); }
            catch { if (!closed) status('polling'); }
            finally { running = false; if (again && !closed) { again = false; schedule(); } }
        }, 50);
    };
    let channel;
    const releaseChannel = () => {
        const current = channel;
        channel = null;
        if (!current) return;
        try { Promise.resolve(client.removeChannel(current)).catch(() => {}); }
        catch { /* Cleanup failure must not block local logout or state clearing. */ }
    };
    try {
        channel = client.channel('homehub-calendar:' + owner);
        for (const table of ['calendar_events', 'notification_preferences']) {
            for (const event of ['INSERT', 'UPDATE']) {
                channel.on('postgres_changes', { event, schema: 'public', table, filter: 'user_id=eq.' + owner }, payload => {
                    if (!closed && payload.new?.user_id === owner) schedule();
                });
            }
        }
        channel.subscribe(state => {
            if (closed) return;
            if (state === 'SUBSCRIBED') { status('connected'); schedule(); }
            else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) status('polling');
        });
    } catch {
        status('polling');
        releaseChannel();
    }
    return () => {
        if (closed) return;
        closed = true; clearTimeout(timer);
        releaseChannel();
    };
}
