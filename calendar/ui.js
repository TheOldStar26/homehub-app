import { CATEGORIES, REPEATS, label, today, addDays, parts, occurrences, viewRange, shiftView, validDate, reminderTimes, REMINDER_LABELS, eventOffsets, parseOffsets } from './model.js';
import { Notifications, eventLink } from './notifications.js';
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined)
    n.textContent = text; if (className)
    n.className = className; return n; };
export async function mountCalendar(repository, notificationOptions = {}) {
    const root = document.getElementById('calendarArea'), settings = document.getElementById('notificationsArea');
    let disposed = false, refreshSequence = 0, preferencesDirty = false;
    let unsubscribe = () => {};
    const isCurrent = notificationOptions.isCurrent || (() => true);
    const notifications = new Notifications(repository, notificationOptions);
    let events = await repository.list(), prefs = await repository.preferences(), anchor = today(), view = 'month', filter = 'all', editing = null;
    if (!isCurrent())
        return { refresh: async () => { }, open() { }, destroy() { } };
    root.replaceChildren();
    settings.replaceChildren();
    const toast = text => { const box = document.getElementById('toast'); box.textContent = text; box.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.style.display = 'none', 5500); };
    const run = fn => async () => { try {
        await fn();
    }
    catch (e) {
        toast(e.message);
    } };
    const syncStatus = el('p', repository.mock ? 'Local demo only: events do not sync between devices.' : 'Development account: changes refresh automatically; deletions refresh within 15 seconds while open.', 'muted');
    syncStatus.id = 'calendarSyncStatus';
    syncStatus.setAttribute('role', 'status');
    root.append(syncStatus);
    const toolbar = el('div', undefined, 'calendarToolbar');
    const heading = el('h2');
    heading.id = 'calendarHeading';
    function button(text, action, cls = 'secondary') { const b = el('button', text, cls); b.type = 'button'; b.onclick = run(action); return b; }
    toolbar.append(button('‹', () => { anchor = shiftView(anchor, view, -1); render(); }), button('Today', () => { anchor = today(); render(); }), button('›', () => { anchor = shiftView(anchor, view, 1); render(); }), button('+ Add event', () => open()));
    toolbar.firstChild.setAttribute('aria-label', 'Previous period');
    toolbar.children[2].setAttribute('aria-label', 'Next period');
    const views = el('div', undefined, 'calendarViews');
    views.setAttribute('aria-label', 'Calendar view');
    for (const v of ['month', 'week', 'day']) {
        const b = button(label(v), () => { view = v; render(); });
        b.dataset.view = v;
        views.append(b);
    }
    const category = el('select');
    category.setAttribute('aria-label', 'Filter calendar category');
    for (const c of ['all', ...CATEGORIES]) {
        const o = el('option', c === 'all' ? 'All categories' : label(c));
        o.value = c;
        category.append(o);
    }
    category.onchange = () => { filter = category.value; render(); };
    views.append(category);
    const grid = el('div', undefined, 'calendarGrid');
    grid.setAttribute('aria-labelledby', heading.id);
    const agenda = el('div', undefined, 'calendarAgenda');
    root.append(heading, toolbar, views, grid, agenda);
    const dialog = el('dialog');
    dialog.id = 'calendarEditor';
    const form = el('form');
    const title = el('h2');
    const error = el('p');
    error.className = 'formError';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    form.append(title, button('Close', () => dialog.close(), 'plain'), error);
    const fields = {};
    function field(name, text, type = 'text', options = null) { const wrap = el('label', text); const input = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input'); input.id = 'event-' + name; input.name = name; if (input.tagName === 'INPUT')
        input.type = type; if (options)
        for (const [value, text] of options) {
            const o = el('option', text);
            o.value = value;
            input.append(o);
        } wrap.append(input); form.append(wrap); fields[name] = input; return input; }
    field('title', 'Event title').required = true;
    fields.title.maxLength = 120;
    field('category', 'Category', 'select', CATEGORIES.map(x => [x, label(x)]));
    field('all_day', 'All day', 'checkbox').parentElement.className = 'check';
    field('start_date', 'Start date', 'date').required = true;
    field('end_date', 'End date', 'date').required = true;
    field('start_time', 'Start time', 'time');
    field('end_time', 'End time', 'time');
    field('timezone', 'Timezone').required = true;
    fields.timezone.setAttribute('list', 'timezones');
    const zones = el('datalist');
    zones.id = 'timezones';
    for (const z of ['Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Tokyo', 'UTC']) {
        const o = el('option');
        o.value = z;
        zones.append(o);
    }
    form.append(zones);
    field('recurrence', 'Repeat', 'select', REPEATS.map(x => [x, x === 'none' ? 'Does not repeat' : label(x)]));
    field('until', 'Repeat until (optional)', 'date');
    const repeatHint = el('p', 'Editing or deleting a recurring event changes the whole series. Months without the chosen day are skipped. Repeated autumn times use the first occurrence.', 'muted');
    form.append(repeatHint);
    field('reminder', 'Reminder', 'select', [['default', 'Category default'], ['off', 'Off'], ['custom', 'Custom reminders…'], ['0', 'At event time'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'], ['10080', '1 week before']]);
    field('reminder_offsets', 'Custom reminders (comma-separated offsets)');
    const hint = el('p', undefined, 'muted');
    form.append(hint);
    field('notes', 'Notes', 'textarea');
    fields.notes.maxLength = 2000;
    const actions = el('div', undefined, 'actions'), save = el('button', 'Save event'), remove = button('Delete event', async () => { if (!confirm('Delete this event' + (editing?.recurrence !== 'none' ? ' and its entire series' : '') + '?'))
        return; await repository.remove(editing.id); dialog.close(); await refresh(); }, 'danger'), preview = button('Test notification tap', () => notifications.preview(editing, anchor));
    save.type = 'submit';
    actions.append(save, remove, preview);
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);
    function reminderControls() {
        const all = fields.all_day.checked, p = prefs[fields.category.value];
        fields.reminder_offsets.parentElement.hidden = fields.reminder.value !== 'custom';
        fields.reminder_offsets.parentElement.firstChild.textContent = all ? 'Custom reminders: days before (comma-separated)' : 'Custom reminders: minutes before (comma-separated)';
        const values = all ? p.days : p.minutes;
        hint.textContent = (all ? 'All reminders use 9am local time. 0 means the event day. ' : '0 means the event start time. ') + `Category defaults: ${p.enabled && values.length ? values.join(', ') + (all ? ' days' : ' minutes') + ' before' : 'disabled'}. Blank custom offsets disable this event’s reminders.`;
    }
    function controls() {
        const all = fields.all_day.checked;
        fields.start_time.parentElement.hidden = all;
        fields.end_time.parentElement.hidden = all;
        fields.start_time.required = !all;
        fields.end_time.required = !all;
        fields.end_date.parentElement.firstChild.textContent = all ? 'End date (last day included)' : 'End date';
        const selected = fields.reminder.value;
        fields.reminder.replaceChildren();
        const choices = all ? [['default', 'Category defaults'], ['off', 'Off'], ['custom', 'Custom reminders…'], ['0', 'Same day at 9am'], ['1', '1 day before at 9am'], ['3', '3 days before at 9am'], ['7', '1 week before at 9am'], ['30', '30 days before at 9am']] : [['default', 'Category defaults'], ['off', 'Off'], ['custom', 'Custom reminders…'], ['0', 'At event time'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['720', '12 hours before'], ['1440', '1 day before'], ['4320', '3 days before'], ['10080', '1 week before'], ['43200', '30 days before']];
        for (const [value, text] of choices) {
            const o = el('option', text);
            o.value = value;
            fields.reminder.append(o);
        }
        fields.reminder.value = choices.some(x => x[0] === selected) ? selected : 'default';
        reminderControls();
        fields.until.parentElement.hidden = fields.recurrence.value === 'none';
    }
    fields.all_day.onchange = () => { fields.reminder.value = 'default'; fields.reminder_offsets.value = ''; controls(); };
    fields.reminder.onchange = reminderControls;
    fields.category.onchange = reminderControls;
    fields.recurrence.onchange = () => { fields.until.parentElement.hidden = fields.recurrence.value === 'none'; };
    fields.start_date.onchange = () => { if (fields.end_date.value < fields.start_date.value)
        fields.end_date.value = fields.start_date.value; };
    function open(event = null, date = anchor) {
        editing = event;
        error.hidden = true;
        form.reset();
        title.textContent = event ? 'Edit event' + (event.recurrence !== 'none' ? ' series' : '') : 'New event';
        for (const name of Object.keys(fields)) {
            if (name === 'all_day')
                fields[name].checked = event?.all_day || false;
            else
                fields[name].value = event?.[name] ?? ({ category: 'personal', start_date: date, end_date: date, start_time: '10:00', end_time: '11:00', timezone: 'Europe/London', recurrence: 'none', reminder: 'default' }[name] || '');
        }
        if (event?.all_day)
            fields.end_date.value = addDays(event.end_date, -1);
        controls();
        const offsets = event ? eventOffsets(event) : null;
        fields.reminder.value = offsets === null ? 'default' : offsets.length === 0 ? 'off' : offsets.length === 1 ? String(offsets[0]) : 'custom';
        if (!fields.reminder.value && offsets?.length)
            fields.reminder.value = 'custom';
        fields.reminder_offsets.value = offsets?.join(', ') || '';
        reminderControls();
        remove.hidden = !event;
        preview.hidden = !event;
        dialog.showModal();
        fields.title.focus();
    }
    form.onsubmit = async (e) => { e.preventDefault(); error.hidden = true; save.disabled = true; try {
        const data = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'all_day').map(([k, input]) => [k, input.value]));
        data.all_day = fields.all_day.checked;
        data.end_date = data.all_day ? addDays(data.end_date, 1) : data.end_date;
        data.reminders = data.reminder === 'default' ? null : data.reminder === 'off' ? [] : data.reminder === 'custom' ? parseOffsets(data.reminder_offsets, data.all_day ? 365 : 525600) : [Number(data.reminder)];
        data.reminder = null;
        delete data.reminder_offsets;
        data.until = data.recurrence === 'none' ? null : data.until || null;
        await repository.save({ ...editing, ...data });
        dialog.close();
        await refresh();
        toast(repository.mock ? 'Event saved in this development browser.' : 'Event saved in your development account.');
    }
    catch (e) {
        error.textContent = e.message;
        error.hidden = false;
    }
    finally {
        save.disabled = false;
    } };
    async function refresh() {
        const sequence = ++refreshSequence;
        const [loaded, latestPreferences] = await Promise.all([repository.list(), repository.preferences()]);
        if (disposed || !isCurrent() || sequence !== refreshSequence) return;
        events = loaded;
        if (!preferencesDirty) {
            prefs = latestPreferences;
            for (const c of CATEGORIES) {
                inputs[c].enabled.checked = prefs[c].enabled;
                inputs[c].days.value = prefs[c].days.join(', ');
                inputs[c].minutes.value = prefs[c].minutes.join(', ');
            }
        }
        render();
    }
    function render() {
        if (disposed)
            return;
        const range = viewRange(anchor, view);
        heading.textContent = view === 'month' ? new Date(anchor + 'T12:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : view === 'day' ? formatDate(anchor) : `${formatDate(range.from)} – ${formatDate(addDays(range.to, -1))}`;
        for (const b of views.querySelectorAll('[data-view]')) {
            b.classList.toggle('active', b.dataset.view === view);
            b.setAttribute('aria-pressed', String(b.dataset.view === view));
        }
        const items = events.filter(e => filter === 'all' || e.category === filter).flatMap(e => occurrences(e, range.from, range.to)).sort((a, b) => a.startInstant.localeCompare(b.startInstant));
        grid.replaceChildren();
        agenda.replaceChildren();
        grid.className = 'calendarGrid ' + view;
        if (view === 'month')
            for (const weekday of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
                grid.append(el('div', weekday, 'weekday'));
        for (let date = range.from; date < range.to; date = addDays(date, 1)) {
            const cell = el('section', undefined, 'calendarCell' + (date === today() ? ' today' : '') + (date.slice(0, 7) !== anchor.slice(0, 7) && view === 'month' ? ' outside' : ''));
            const dayButton = button(view === 'month' ? String(Number(date.slice(8))) : formatDate(date), () => { anchor = date; view = 'day'; render(); }, 'dayNumber');
            dayButton.setAttribute('aria-label', 'View ' + formatDate(date));
            cell.append(dayButton);
            const dayItems = items.filter(o => o.occurrence_date <= date && (o.all_day ? o.occurrence_end > date : o.occurrence_end >= date));
            for (const o of dayItems) {
                const b = button((o.all_day ? '' : o.start_time + ' ') + o.title, () => { anchor = o.occurrence_date; open(events.find(e => e.id === o.id)); }, 'calendarEvent cat-' + o.category);
                b.setAttribute('aria-label', o.title + ', ' + label(o.category) + ', ' + (o.all_day ? 'all day' : o.start_time) + ' ' + o.timezone);
                cell.append(b);
            }
            if (view === 'day' && !dayItems.length)
                cell.append(el('p', 'No events today.'));
            grid.append(cell);
        }
        agenda.append(el('h3', 'Agenda'));
        if (!items.length)
            agenda.append(el('p', 'No events in this period. Add an event to get started.'));
        for (const o of items) {
            const card = button('', () => { anchor = o.occurrence_date; open(events.find(e => e.id === o.id)); }, 'item');
            const detail = el('div');
            detail.append(el('strong', o.title), el('small', `${formatDate(o.occurrence_date)} · ${o.all_day ? 'All day' : o.start_time + '–' + o.end_time} · ${label(o.category)} · ${o.timezone}${o.recurrence === 'none' ? '' : ' · ' + label(o.recurrence)}`));
            card.append(detail);
            agenda.append(card);
        }
    }
    function formatDate(date) { return new Date(date + 'T12:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
    // Notification settings and per-category default preferences.
    settings.append(el('h2', 'Notification settings'), el('p', 'Choose reminders for each category. All-day reminders arrive at 9am in the event’s timezone. Timed-event offsets are measured before the start.'));
    const status = el('p');
    status.id = 'notificationStatus';
    status.setAttribute('role', 'status');
    settings.append(status);
    const notificationButtons = el('div', undefined, 'actions');
    notificationButtons.append(button('Enable Notifications', async () => { status.textContent = await notifications.enable(); }), button('Disable Notifications', async () => { status.textContent = await notifications.disable(); }));
    settings.append(notificationButtons);
    const pending = el('p', 'Agreed defaults are enabled below. Customise the comma-separated offsets or turn any category off. All-day sub-day reminders use the event day at 9am. Mock enrollment does not send real push notifications.', 'muted');
    settings.append(pending);
    const preferences = el('form');
    preferences.id = 'reminderPreferences';
    preferences.addEventListener('input', () => { preferencesDirty = true; });
    preferences.addEventListener('change', () => { preferencesDirty = true; });
    const inputs = {};
    for (const c of CATEGORIES) {
        const row = el('fieldset', undefined, 'preferenceRow');
        row.append(el('legend', REMINDER_LABELS[c]));
        const enabledWrap = el('label', 'Automatic reminders', 'check'), enabled = el('input');
        enabled.type = 'checkbox';
        enabled.checked = prefs[c].enabled;
        enabledWrap.append(enabled);
        const daysWrap = el('label', 'All-day: days before (comma-separated)'), days = el('input');
        days.type = 'text';
        days.value = prefs[c].days.join(', ');
        daysWrap.append(days);
        const minutesWrap = el('label', 'Timed: minutes before (comma-separated)'), minutes = el('input');
        minutes.type = 'text';
        minutes.value = prefs[c].minutes.join(', ');
        minutesWrap.append(minutes);
        inputs[c] = { enabled, days, minutes };
        row.append(enabledWrap, daysWrap, minutesWrap);
        preferences.append(row);
    }
    const prefSave = el('button', 'Save reminder preferences');
    prefSave.type = 'submit';
    preferences.append(prefSave);
    preferences.onsubmit = async (e) => { e.preventDefault(); try {
        const next = Object.fromEntries(CATEGORIES.map(c => [c, { enabled: inputs[c].enabled.checked, days: parseOffsets(inputs[c].days.value, 365), minutes: parseOffsets(inputs[c].minutes.value, 525600) }]));
        await repository.setPreferences(next);
        prefs = next;
        preferencesDirty = false;
        toast(repository.mock ? 'Reminder preferences saved locally.' : 'Reminder preferences saved in your development account.');
    }
    catch (e) {
        toast(e.message);
    } };
    settings.append(preferences);
    const samples = el('div');
    samples.id = 'reminderPreview';
    settings.append(button('Preview scheduled reminders', () => { samples.replaceChildren(); for (const e of events) {
        const o = occurrences(e, today(), addDays(today(), 367))[0];
        if (!o)
            continue;
        for (const time of reminderTimes(o, prefs)) {
            const p = parts(time, e.timezone);
            samples.append(el('p', `${e.title}: ${p.date} ${p.time} ${e.timezone}`));
        }
    } if (!samples.children.length)
        samples.append(el('p', 'No automatic reminders enabled. Choose category defaults or an event reminder.')); }), samples);
    status.textContent = repository.mock ? (repository.data?.notifications ? 'Mock notifications enabled.' : 'Mock mode: notifications disabled. No backend connection.') : 'Use Enable Notifications to enroll this device. Permission is requested only after your tap.';
    if (!repository.mock)
        pending.textContent = 'Agreed defaults are enabled. Customise or disable reminders below; changes save only to your separate development account.';
    render();
    const link = eventLink(location.href);
    if (link) {
        const event = events.find(e => e.id === link.id);
        if (event) {
            anchor = validDate(link.date) ? link.date : event.start_date;
            view = 'day';
            render();
            open(event);
        }
        else
            toast('This calendar event was deleted or is unavailable.');
    }
    const handleMessage = event => { if (disposed)
        return; if (event.data?.type === 'OPEN_CALENDAR_EVENT') {
        const link = eventLink(event.data.url);
        const found = events.find(e => e.id === link?.id);
        if (found) {
            anchor = validDate(link.date) ? link.date : found.start_date;
            view = 'day';
            render();
            open(found);
        }
    } };
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    if (repository.subscribe) unsubscribe = repository.subscribe(refresh, state => {
        if (!disposed && isCurrent()) syncStatus.textContent = state === 'connected'
            ? 'Realtime connected. Changes refresh automatically; deletions refresh within 15 seconds while open.'
            : 'Realtime unavailable. Refreshing every 15 seconds while open; reconnect on focus or online.';
    });
    return { refresh, open, destroy() { disposed = true; unsubscribe(); refreshSequence++; clearTimeout(toast.timer); dialog.close(); dialog.remove(); root.replaceChildren(); settings.replaceChildren(); events = []; prefs = {}; navigator.serviceWorker?.removeEventListener('message', handleMessage); } };
}
