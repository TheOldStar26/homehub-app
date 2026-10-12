import { subscribeCalendar } from './realtime.js';
import { CATEGORIES, DEFAULTS, today, addDays, validateEvent, normalisePreferences } from './model.js';
const KEY = 'homehub-calendar-dev:mock-user:v1';
export function fixtures() { const day = today(); return CATEGORIES.map((category, i) => ({ id: crypto.randomUUID(), title: ['Coffee with Alex', 'Family lunch', 'Team catch-up', 'Sam’s birthday', 'Council tax', 'MOT booking', 'Boiler service'][i], category, all_day: i >= 3, start_date: addDays(day, i - 2), end_date: addDays(day, i - 2 + (i >= 3 ? 1 : 0)), start_time: '10:00', end_time: '11:00', timezone: 'Europe/London', recurrence: category === 'birthday' ? 'yearly' : category === 'work' ? 'weekly' : 'none', until: null, exceptions: [], notes: 'Synthetic development example', reminder: null, completed: false, version: 1 })); }
export class MockRepository {
    constructor(storage = globalThis.localStorage) { this.storage = storage; let data; try {
        data = JSON.parse(storage?.getItem(KEY));
    }
    catch { } this.data = data?.events && data?.prefs ? data : { events: fixtures(), prefs: structuredClone(DEFAULTS), notifications: false }; const pristine = data && !data.prefsCustomized && CATEGORIES.every(c => data.prefs?.[c]?.enabled === false && data.prefs[c].days === 1 && data.prefs[c].minutes === 60); this.data.prefs = normalisePreferences(pristine ? DEFAULTS : this.data.prefs); this.mock = true; }
    commit() { try {
        this.storage?.setItem(KEY, JSON.stringify(this.data));
    }
    catch {
        throw Error('This browser could not save the mock data. Check storage permissions.');
    } }
    async list() { return structuredClone(this.data.events); }
    async save(event) { const valid = validateEvent(event), old = this.data.events.find(x => x.id === valid.id); const next = { ...valid, id: valid.id || crypto.randomUUID(), version: (old?.version || 0) + 1 }; const backup = structuredClone(this.data); this.data.events = this.data.events.filter(x => x.id !== next.id).concat(next); try {
        this.commit();
    }
    catch (e) {
        this.data = backup;
        throw e;
    } return next; }
    async remove(id) { const backup = structuredClone(this.data); this.data.events = this.data.events.filter(x => x.id !== id); try {
        this.commit();
    }
    catch (e) {
        this.data = backup;
        throw e;
    } }
    async preferences() { return structuredClone(this.data.prefs); }
    async setPreferences(prefs) { const old = structuredClone(this.data); this.data.prefs = normalisePreferences(prefs); this.data.prefsCustomized = true; try {
        this.commit();
    }
    catch (e) {
        this.data = old;
        throw e;
    } }
    async setNotifications(enabled) { const old = this.data.notifications; this.data.notifications = enabled; try {
        this.commit();
    }
    catch (e) {
        this.data.notifications = old;
        throw e;
    } }
    async reset() { this.data = { events: fixtures(), prefs: structuredClone(DEFAULTS), notifications: false }; this.commit(); }
}
// Explicitly injected test client only; never constructed by the mock application.
export class SupabaseCalendarRepository {
    constructor(client, userId) { this.client = client; this.userId = userId; this.mock = false; }
    subscribe(refresh, status) { return subscribeCalendar(this.client, this.userId, refresh, status); }
    async list() { const rows = []; for (let offset = 0;; offset += 500) {
        const { data, error } = await this.client.from('calendar_events').select('*').eq('user_id', this.userId).order('id').range(offset, offset + 499);
        if (error)
            throw error;
        rows.push(...data.map(e => ({ ...e, start_time: e.start_time.slice(0, 5), end_time: e.end_time.slice(0, 5) })));
        if (data.length < 500)
            return rows;
    } }
    async save(event) { const valid = validateEvent(event); const { key, occurrence_date, occurrence_end, startInstant, endInstant, ...row } = valid; let q = row.id ? this.client.from('calendar_events').update(row).eq('id', row.id).eq('user_id', this.userId).eq('version', valid.version) : this.client.from('calendar_events').insert({ ...row, user_id: this.userId }); const { data, error } = await q.select().single(); if (error) {
        if (row.id && error.code === 'PGRST116') throw Error('This event changed or was removed on another device. Close the editor, refresh and reopen it before saving.');
        throw error; } return data; }
    async remove(id) { const { error } = await this.client.from('calendar_events').delete().eq('id', id).eq('user_id', this.userId).select('id').single(); if (error)
        throw error; }
    async preferences() { const { data, error } = await this.client.from('notification_preferences').select('categories').eq('user_id', this.userId).maybeSingle(); if (error)
        throw error; return normalisePreferences(data?.categories || DEFAULTS); }
    async setPreferences(categories) { categories = normalisePreferences(categories); const { data, error: readError } = await this.client.from('notification_preferences').select('enabled').eq('user_id', this.userId).maybeSingle(); if (readError)
        throw readError; const { error } = await this.client.from('notification_preferences').upsert({ user_id: this.userId, categories, enabled: data?.enabled || false }); if (error)
        throw error; }
    async setNotifications(enabled) { const categories = await this.preferences(); const { error } = await this.client.from('notification_preferences').upsert({ user_id: this.userId, enabled, categories }); if (error)
        throw error; }
}
