import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { MockRepository, SupabaseCalendarRepository } from '../calendar/repository.js';
import { mountCalendar } from '../calendar/ui.js';
import { DEFAULTS } from '../calendar/model.js';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
async function setup() {
  const dom = new JSDOM(html, { url: 'https://theoldstar26.github.io/homehub-app/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, confirm: () => true });
  globalThis.navigator ??= dom.window.navigator;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const repo = new MockRepository(dom.window.localStorage), ui = await mountCalendar(repo);
  return { repo, ui, close() { ui.destroy(); dom.window.close(); } };
}
const field = name => document.getElementById('event-' + name);
const change = node => node.dispatchEvent(new window.Event('change'));
const submit = () => document.querySelector('#calendarEditor form').onsubmit({ preventDefault() {} });
test('all timed presets, multiple choices, custom offsets and edits persist after reload', async () => {
  const s = await setup();
  try {
    s.ui.open(); field('title').value = 'Reminder roundtrip test';
    const options = [...field('reminder').options].map(o => o.value);
    for (const value of ['0','5','10','15','30','60','720','1440','custom']) assert.ok(options.includes(value));
    assert.ok(document.getElementById('eventReminderSettings').compareDocumentPosition(field('recurrence')) & 4);
    field('reminder').value = '10'; change(field('reminder'));
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Choose multiple reminders').click();
    for (const value of ['0','720']) { const input = document.querySelector(`.reminderPresets input[value="${value}"]`); input.checked = true; change(input); }
    await submit();
    let row = (await s.repo.list()).find(e => e.title === 'Reminder roundtrip test');
    assert.deepEqual(row.reminders, [720,10,0]);
    assert.deepEqual((await new MockRepository(window.localStorage).list()).find(e => e.id === row.id).reminders, [720,10,0]);
    s.ui.open(row);
    assert.equal(field('reminder').value, 'custom');
    assert.deepEqual([...document.querySelectorAll('.reminderPresets input:checked')].map(n => +n.value), [0,10,720]);
    field('reminder_offsets').value = '27, 5, 0'; await submit();
    row = (await s.repo.list()).find(e => e.id === row.id);
    assert.deepEqual(row.reminders, [27,5,0]);
    s.ui.open(row); field('reminder').value = 'off'; await submit();
    assert.deepEqual((await s.repo.list()).find(e => e.id === row.id).reminders, []);
    s.ui.open((await s.repo.list()).find(e => e.id === row.id)); field('reminder').value = 'default'; await submit();
    assert.equal((await s.repo.list()).find(e => e.id === row.id).reminders, null);
  } finally { s.close(); }
});
test('all-day reminders keep day units; invalid custom input cannot overwrite an event', async () => {
  const s = await setup();
  try {
    s.ui.open(); field('title').value = 'All day reminders';
    field('all_day').checked = true; change(field('all_day'));
    field('reminder').value = 'custom'; change(field('reminder'));
    field('reminder_offsets').value = '1, 0'; await submit();
    const row = (await s.repo.list()).find(e => e.title === 'All day reminders');
    assert.deepEqual(row.reminders, [1,0]);
    s.ui.open(row); field('reminder_offsets').value = '-1, 0'; await submit();
    assert.equal(document.getElementById('calendarEditor').open, true);
    assert.deepEqual((await s.repo.list()).find(e => e.id === row.id).reminders, [1,0]);
  } finally { s.close(); }
});
test('Supabase save carries every reminder and owner ID; preferences preserve enablement', async () => {
  const writes = [];
  const db = { from: table => ({
    insert(row) { writes.push({ table, row }); return this; }, upsert(row) { writes.push({table,row}); return Promise.resolve({error:null}); },
    select() { return this; }, eq() { return this; },
    single: async () => ({ data: writes.at(-1).row, error: null }),
    maybeSingle: async () => ({ data: { categories: DEFAULTS, enabled: true }, error: null }),
  }) };
  const repo = new SupabaseCalendarRepository(db, 'owner-test');
  await repo.save({ title:'Test', category:'personal', all_day:false, start_date:'2026-11-01', end_date:'2026-11-01', start_time:'10:00', end_time:'11:00', timezone:'UTC', recurrence:'none', reminders:[720,10,5,0] });
  assert.deepEqual(writes[0].row.reminders, [720,10,5,0]); assert.equal(writes[0].row.user_id, 'owner-test');
  await repo.setPreferences(DEFAULTS); assert.equal(writes.at(-1).row.enabled, true);
});
