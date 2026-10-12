// Shared browser/Edge Function calendar rules. No network or persistence.
export const CATEGORIES = ['personal', 'family', 'work', 'birthday', 'bill', 'vehicle', 'maintenance'];
export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
// Appointments map to personal/family; work shifts to work; MOT/insurance to vehicle.
// Sub-day all-day reminders become same-day 09:00 (never an arbitrary overnight alert).
export const DEFAULTS = {
    personal: { enabled: true, minutes: [1440, 60], days: [1, 0] },
    family: { enabled: true, minutes: [1440, 60], days: [1, 0] },
    work: { enabled: true, minutes: [720], days: [0] },
    birthday: { enabled: true, minutes: [10080, 0], days: [7, 0] },
    bill: { enabled: true, minutes: [4320], days: [3] },
    vehicle: { enabled: true, minutes: [43200, 10080], days: [30, 7] },
    maintenance: { enabled: true, minutes: [10080, 1440], days: [7, 1] },
};
export const REMINDER_LABELS = { personal: 'Personal appointments', family: 'Family appointments', work: 'Work shifts', birthday: 'Birthdays', bill: 'Bills', vehicle: 'MOT and insurance', maintenance: 'Maintenance' };
export function normaliseOffsets(value, max) {
    const offsets = Array.isArray(value) ? value : [value];
    if (offsets.length > 10 || offsets.some(n => !Number.isInteger(n) || n < 0 || n > max))
        throw Error(`Use up to 10 whole-number offsets between 0 and ${max}.`);
    return [...new Set(offsets)].sort((a, b) => b - a);
}
export function parseOffsets(text, max) {
    if (!text.trim())
        return [];
    const values = text.split(',').map(s => s.trim());
    if (values.some(s => !/^\d+$/.test(s)))
        throw Error('Enter whole numbers separated by commas, such as 7, 1.');
    return normaliseOffsets(values.map(Number), max);
}
export function normalisePreferences(prefs = {}) {
    return Object.fromEntries(CATEGORIES.map(c => { const p = prefs[c] ?? DEFAULTS[c]; if (typeof p.enabled !== 'boolean')
        throw Error('Choose whether category reminders are enabled.'); return [c, { enabled: p.enabled, days: normaliseOffsets(p.days, 365), minutes: normaliseOffsets(p.minutes, 525600) }]; }));
}
export function eventOffsets(event) {
    if (event.reminders !== undefined && event.reminders !== null)
        return normaliseOffsets(event.reminders, event.all_day ? 365 : 525600);
    return event.reminder === null || event.reminder === undefined ? null : event.reminder === -1 ? [] : normaliseOffsets(event.reminder, event.all_day ? 365 : 525600);
}
export const label = s => s.charAt(0).toUpperCase() + s.slice(1);
export function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
export function addDays(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function dateDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
export function parts(instant, zone) { const p = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)); const get = k => p.find(x => x.type === k).value; return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, second: get('second') }; }
export function today(zone = 'Europe/London', now = new Date()) { return parts(now, zone).date; }
export function localInstant(date, time, zone) {
    if (typeof time === 'string' && /^\d{2}:\d{2}:00$/.test(time))
        time = time.slice(0, 5);
    if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        throw Error('Enter a valid date and time.');
    const wall = Date.parse(`${date}T${time}:00Z`);
    let guess = wall;
    for (let i = 0; i < 4; i++) {
        const p = parts(guess, zone);
        const rendered = Date.parse(`${p.date}T${p.time}:${p.second}Z`);
        const correction = wall - rendered;
        if (!correction)
            break;
        guess += correction;
    }
    const p = parts(guess, zone);
    if (p.date !== date || p.time !== time)
        throw Error('This local time does not exist because the clocks change. Choose another time.');
    // For a repeated autumn hour choose the earlier occurrence deterministically.
    for (const shift of [7200000, 3600000, 1800000]) {
        const earlier = parts(guess - shift, zone);
        if (earlier.date === date && earlier.time === time)
            guess -= shift;
    }
    return new Date(guess).toISOString();
}
export function validateEvent(e) {
    if (!e.title?.trim() || e.title.trim().length > 120)
        throw Error('Enter a title of up to 120 characters.');
    if ((e.notes || '').length > 2000)
        throw Error('Notes must be 2000 characters or fewer.');
    if (!CATEGORIES.includes(e.category) || !REPEATS.includes(e.recurrence))
        throw Error('Choose a valid category and repeat pattern.');
    try {
        parts(new Date(), e.timezone);
    }
    catch {
        throw Error('Enter a valid timezone, such as Europe/London.');
    }
    if (!validDate(e.start_date) || !validDate(e.end_date) || e.end_date < e.start_date)
        throw Error('End date must follow the start date.');
    if (e.all_day) {
        if (e.end_date <= e.start_date)
            throw Error('All-day end date is exclusive and must follow the start date.');
    }
    else {
        const start = localInstant(e.start_date, e.start_time, e.timezone), end = localInstant(e.end_date, e.end_time, e.timezone);
        if (end <= start)
            throw Error('End time must follow the start time.');
    }
    if (e.until && (!validDate(e.until) || e.until < e.start_date))
        throw Error('Repeat until must be on or after the first event.');
    if (e.reminder !== undefined && e.reminder !== null && (!Number.isInteger(e.reminder) || e.reminder < -1 || e.reminder > (e.all_day ? 365 : 525600)))
        throw Error('Choose a valid reminder offset.');
    const reminders = eventOffsets(e);
    return { ...e, reminders, title: e.title.trim(), notes: e.notes || '', version: e.version || 1 };
}
function candidate(e, n) {
    const [y, m, d] = e.start_date.split('-').map(Number);
    if (e.recurrence === 'daily')
        return addDays(e.start_date, n);
    if (e.recurrence === 'weekly')
        return addDays(e.start_date, n * 7);
    if (e.recurrence === 'none')
        return n === 0 ? e.start_date : null;
    const month = e.recurrence === 'monthly' ? m - 1 + n : m - 1;
    const year = e.recurrence === 'yearly' ? y + n : y;
    const result = new Date(Date.UTC(year, month, d, 12)).toISOString().slice(0, 10);
    // Skip dates that do not exist (31st, February 29), never drift the series.
    return Number(result.slice(8)) === d ? result : null;
}
export function occurrences(e, from, to) {
    const output = [];
    const duration = dateDiff(e.start_date, e.end_date);
    const first = addDays(from, -duration - 1);
    let n = 0;
    if (e.recurrence === 'daily')
        n = Math.max(0, dateDiff(e.start_date, first));
    if (e.recurrence === 'weekly')
        n = Math.max(0, Math.floor(dateDiff(e.start_date, first) / 7));
    if (e.recurrence === 'monthly')
        n = Math.max(0, (Number(first.slice(0, 4)) - Number(e.start_date.slice(0, 4))) * 12 + Number(first.slice(5, 7)) - Number(e.start_date.slice(5, 7)) - 1);
    if (e.recurrence === 'yearly')
        n = Math.max(0, Number(first.slice(0, 4)) - Number(e.start_date.slice(0, 4)) - 1);
    for (let i = 0; i < 10000; i++, n++) {
        if (e.recurrence === 'none' && n > 0)
            break;
        const date = candidate(e, n);
        if (!date)
            continue;
        if (date >= to || (e.until && date > e.until))
            break;
        if ((e.exceptions || []).includes(date))
            continue;
        const end = addDays(date, duration);
        if ((e.all_day ? end : addDays(end, 1)) <= from)
            continue;
        let startInstant, endInstant;
        try {
            startInstant = localInstant(date, e.all_day ? '09:00' : e.start_time, e.timezone);
            endInstant = e.all_day ? null : localInstant(end, e.end_time, e.timezone);
        }
        catch {
            continue;
        }
        output.push({ ...e, occurrence_date: date, occurrence_end: end, startInstant, endInstant, key: `${e.id}:${date}` });
    }
    return output;
}
export function reminderTimes(o, prefs) {
    const pref = prefs?.[o.category] || DEFAULTS[o.category];
    const override = eventOffsets(o);
    if (override === null && !pref.enabled)
        return [];
    const offsets = override === null ? normaliseOffsets(o.all_day ? pref.days : pref.minutes, o.all_day ? 365 : 525600) : override;
    return [...new Set(offsets.map(offset => o.all_day ? localInstant(addDays(o.occurrence_date, -offset), '09:00', o.timezone) : new Date(Date.parse(o.startInstant) - offset * 60000).toISOString()))].sort();
}
// Compatibility for earlier local fixtures/tests; scheduling uses every reminder.
export function reminderTime(o, prefs) { return reminderTimes(o, prefs)[0] ?? null; }
export function dueReminders(events, prefs, from, to) {
    from = new Date(from).toISOString();
    to = new Date(to).toISOString();
    const due = [];
    for (const e of events) {
        if (e.completed)
            continue;
        try {
            const localFrom = addDays(parts(from, e.timezone).date, -2), localTo = addDays(parts(to, e.timezone).date, 367);
            for (const o of occurrences(e, localFrom, localTo))
                for (const sendAt of reminderTimes(o, prefs)) {
                    if (sendAt >= from && sendAt <= to)
                        due.push({ event: e, occurrence: o, sendAt, key: `${o.key}:${e.version}:${sendAt}` });
                }
        }
        catch {
            continue;
        } // One invalid/imported timezone must not stop other owners' reminders.
    }
    return due;
}
export function viewRange(anchor, view) {
    if (view === 'day')
        return { from: anchor, to: addDays(anchor, 1) };
    if (view === 'week') {
        const dow = (new Date(anchor + 'T12:00Z').getUTCDay() + 6) % 7;
        const from = addDays(anchor, -dow);
        return { from, to: addDays(from, 7) };
    }
    const first = anchor.slice(0, 7) + '-01', dow = (new Date(first + 'T12:00Z').getUTCDay() + 6) % 7;
    const from = addDays(first, -dow);
    return { from, to: addDays(from, 42) };
}
export function shiftView(anchor, view, direction) { if (view === 'month') {
    const d = new Date(anchor.slice(0, 7) + '-01T12:00Z');
    d.setUTCMonth(d.getUTCMonth() + direction);
    return d.toISOString().slice(0, 10);
} return addDays(anchor, direction * (view === 'week' ? 7 : 1)); }
