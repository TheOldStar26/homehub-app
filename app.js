import { maintenanceReminders, dayDifference, calendarReminder, downloadBlob } from './features.js';
import { documentsUI } from './documents.js';
import { mountCalendar } from './calendar/ui.js';
import { SupabaseCalendarRepository } from './calendar/repository.js';
import { Notifications } from './calendar/notifications.js';
import { mountTablet } from './tablet.js';
import { DEFAULTS } from './calendar/model.js';
// Existing HomeHub flow with isolated client injection and calendar integration.
export async function mountHomeHub(db, { mock = false, calendarRepositoryFactory = null, notificationOptions = {} } = {}) {
    let authSubscription;
    const APP_BASE = new URL('./', window.location.href);
    const EMAIL_REDIRECT_TO = APP_BASE.href;
    const $ = id => document.getElementById(id);
    let user = null, records = [], tab = 'all', generation = 0;
    let tablet = null;
    let documents = null, calendar = null, calendarOwner = null, disposed = false, sessionSequence = 0, recordBusy = null;
    const pendingLoads = new Set();
    const timers = [];
    const windowListeners = [];
    const every = (fn, ms) => { const id = window.setInterval(fn, ms); timers.push(id); return id; };
    const listen = (type, fn) => { window.addEventListener(type, fn); windowListeners.push([type, fn]); };
    const show = id => { ['setup', 'auth', 'dashboard'].forEach(x => $(x).hidden = x !== id); $('launchScreen').hidden = true; };
    let toastTimer;
    const toast = msg => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.style.display = 'none', 4500); };
    function clearPrivateState() {
        generation++;
        window.clearTimeout(toastTimer);
        records = [];
        tablet?.destroy();
        tablet = null;
        calendar?.destroy();
        calendar = null;
        calendarOwner = null;
        documents?.reset();
        $('reminderList').replaceChildren();
        $('items').replaceChildren();
        $('calendarArea').replaceChildren();
        $('notificationsArea').replaceChildren();
        $('editor').close();
        $('recordForm').reset();
        recordBusy = null;
        for (const id of ['openJobs', 'soon', 'overdue'])
            $(id).textContent = '0';
        $('syncStatus').textContent = 'Waiting to sync';
        $('toast').style.display = 'none';
        const save = $('recordForm').querySelector('button:not([type]),button[type=submit]');
        if (save)
            save.disabled = false;
        $('delete').disabled = false;
        $('password').value = '';
    }
    let calendarQueue = Promise.resolve();
    async function ensureCalendar() {
        if (!user || disposed)
            return;
        const owner = user.id, version = generation;
        calendarQueue = calendarQueue.catch(() => { }).then(async () => {
            if (disposed || user?.id !== owner || version !== generation)
                return;
            if (calendar && calendarOwner === owner) {
                await calendar.refresh();
                return;
            }
            const repo = calendarRepositoryFactory ? calendarRepositoryFactory(owner) : new SupabaseCalendarRepository(db, owner);
            const mounted = await mountCalendar(repo, { ...notificationOptions, isCurrent: () => !disposed && user?.id === owner && generation === version });
            if (disposed || user?.id !== owner || generation !== version) {
                mounted.destroy();
                return;
            }
            calendar = mounted;
            calendarOwner = owner;
        });
        return calendarQueue;
    }
    function requestSession(session) {
        const sequence = ++sessionSequence;
        const next = session?.user ?? null;
        if (next?.id !== user?.id) {
            clearPrivateState();
            user = null;
            show('auth');
            $('signout').hidden = true;
        }
        if (!next) {
            show('auth');
            $('signout').hidden = true;
            return Promise.resolve();
        }
        return new Promise(resolve => window.setTimeout(async () => {
            try {
                const { data: { user: verified }, error } = await db.auth.getUser();
                if (disposed || sequence !== sessionSequence)
                    return;
                if (error || verified?.id !== next.id)
                    throw error || Error('The development session is invalid.');
                user = verified;
                show('dashboard');
                $('signout').hidden = false;
                await load();
                try {
                    await ensureCalendar();
                }
                catch (error) {
                    if (sequence === sessionSequence) {
                        $('calendarArea').textContent = 'Calendar unavailable: ' + error.message;
                        $('notificationsArea').textContent = 'Calendar backend must be configured before notification enrollment.';
                    }
                }
                ;
                if (new URL(window.location.href).searchParams.has('event'))
                    selectTab('calendar');
            }
            catch (error) {
                if (sequence === sessionSequence && !disposed) {
                    clearPrivateState();
                    user = null;
                    show('auth');
                    authMessage('Could not load your development account: ' + error.message);
                }
            }
            finally {
                resolve();
            }
        }, 0));
    }
    async function init() {
        documents = documentsUI(db, () => user, toast);
        authSubscription = db.auth.onAuthStateChange((_event, session) => { requestSession(session); }).data.subscription;
        const initialSequence = sessionSequence;
        try {
            const { data, error } = await db.auth.getSession();
            if (error)
                throw error;
            if (initialSequence === sessionSequence)
                await requestSession(data.session);
        }
        catch (error) {
            if (initialSequence === sessionSequence) {
                show('auth');
                authMessage('Could not restore your session: ' + error.message);
            }
        }
    }
    let loginPending = false;
    $('authForm').onsubmit = async (e) => {
        e.preventDefault();
        if (loginPending) return;
        loginPending = true;
        try {
            const { error } = await db.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
            if (error) toast(error.message);
        } catch (error) {
            toast('Could not sign in: ' + error.message);
        } finally { loginPending = false; }
    };
    const authMessage = message => { $('authMessage').textContent = message; $('authMessage').hidden = !message; };
    function confirmationError() {
        const url = new URL(window.location.href), hash = new URLSearchParams(url.hash.slice(1));
        const value = name => hash.get(name) || url.searchParams.get(name);
        const code = value('error_code'), error = value('error');
        if (!code && !error && !value('error_description'))
            return;
        const messages = { otp_expired: 'This confirmation link has expired or is no longer valid. Wait before requesting one fresh email, then use only its link.', invalid_token: 'This confirmation link is invalid. Use only the latest confirmation email.', access_denied: 'Email confirmation was rejected. The link may be expired or invalid.' };
        authMessage(messages[code] || messages[error] || 'Email confirmation failed or was rejected. You are not confirmed by this link.');
        // Remove callback error details and any accompanying tokens from browser history.
        for (const key of ['error', 'error_code', 'error_description'])
            url.searchParams.delete(key);
        url.hash = '';
        window.history.replaceState(null, '', url.pathname + url.search);
    }
    let emailRequestBusy = false;
    const cooldownKey = email => 'homehub_email_cooldown:' + email.toLowerCase();
    function cooldownUntil() { try {
        return Number(localStorage.getItem(cooldownKey($('email').value.trim()))) || 0;
    }
    catch {
        return 0;
    } }
    function updateEmailButtons() { const waiting = Date.now() < cooldownUntil(); $('signup').disabled = emailRequestBusy || waiting; $('resend').disabled = emailRequestBusy || waiting; }
    async function requestConfirmation(kind) {
        const email = $('email').value.trim();
        if (!email || !$('email').reportValidity() || (kind === 'signup' && !$('authForm').reportValidity()))
            return;
        if (emailRequestBusy)
            return;
        const until = cooldownUntil();
        if (Date.now() < until) {
            authMessage('Please wait ' + Math.ceil((until - Date.now()) / 1000) + ' seconds before another email request.');
            return;
        }
        emailRequestBusy = true;
        updateEmailButtons();
        try {
            const result = kind === 'signup'
                ? await db.auth.signUp({ email, password: $('password').value, options: { emailRedirectTo: EMAIL_REDIRECT_TO } })
                : await db.auth.resend({ type: 'signup', email, options: { emailRedirectTo: EMAIL_REDIRECT_TO } });
            const error = result.error;
            authMessage(result.data?.mock ? 'Local demo account request completed. No email was sent. Use password homehub-demo to sign in.' : error ? (error.code === 'over_email_send_rate_limit' ? 'Supabase has limited email requests. No new email was sent. Wait for the service limit to reset.' : error.message) : 'Confirmation email requested. Check Inbox and Spam, and use only the newest link.');
        }
        catch (error) {
            authMessage('Email request failed: ' + error.message);
        }
        finally {
            try {
                localStorage.setItem(cooldownKey(email), String(Date.now() + 60000));
            }
            catch { }
            emailRequestBusy = false;
            updateEmailButtons();
        }
    }
    $('signup').onclick = () => requestConfirmation('signup');
    $('resend').onclick = () => requestConfirmation('resend');
    $('email').addEventListener('input', updateEmailButtons);
    listen('storage', updateEmailButtons);
    every(updateEmailButtons, 1000);
    confirmationError();
    updateEmailButtons();
    $('signout').onclick = async () => { if ($('signout').disabled)
        return; $('signout').disabled = true; try {
        if (!mock && calendarOwner && 'serviceWorker' in navigator && 'PushManager' in window)
            await new Notifications(new SupabaseCalendarRepository(db, calendarOwner), notificationOptions).disable();
        const { error } = await db.auth.signOut();
        if (error)
            throw error;
        clearPrivateState();
        user = null;
        show('auth');
        $('signout').hidden = true;
    }
    catch (error) {
        toast('Sign out could not finish: ' + error.message);
    }
    finally {
        $('signout').disabled = false;
    } };
    async function load() {
        if (!user || disposed)
            return;
        const owner = user.id, version = generation, loadKey = owner + ':' + version;
        if (pendingLoads.has(loadKey))
            return;
        pendingLoads.add(loadKey);
        try {
            const all = [];
            for (let offset = 0;; offset += 500) {
                const { data, error } = await db.from('records').select('id,category,title,due_date,amount,notes,completed,created_at').eq('user_id', owner).order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
                if (error)
                    throw error;
                if (version !== generation || user?.id !== owner)
                    return;
                all.push(...data);
                if (data.length < 500)
                    break;
            }
            records = all;
            render();
            $('syncStatus').textContent = 'Synced ' + new Date().toLocaleTimeString();
        }
        catch (error) {
            if (version === generation) {
                $('syncStatus').textContent = 'Sync failed — check connection';
                toast('Could not load records: ' + error.message);
            }
        }
        finally {
            pendingLoads.delete(loadKey);
        }
    }
    const refreshAll = async () => { await load(); if (['calendar', 'notifications'].includes(tab))
        await ensureCalendar(); };
    every(() => { if (!document.hidden)
        refreshAll().catch(error => toast(error.message)); }, 15000);
    listen('focus', () => refreshAll().catch(error => toast(error.message)));
    listen('online', () => refreshAll().catch(error => toast(error.message)));
    $('refresh').onclick = () => refreshAll().catch(error => toast(error.message));
    const dateText = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date';
    const days = s => s ? dayDifference(s) : null;
    function render() { renderSection(); const open = records.filter(r => !r.completed); $('openJobs').textContent = open.filter(r => r.category === 'job').length; $('soon').textContent = open.filter(r => days(r.due_date) !== null && days(r.due_date) >= 0 && days(r.due_date) <= 30).length; $('overdue').textContent = open.filter(r => days(r.due_date) !== null && days(r.due_date) < 0).length; if (!['all', 'job', 'vehicle', 'bill'].includes(tab)) {
        $('listTitle').textContent = '';
        $('count').textContent = '';
        $('items').replaceChildren();
        return;
    } const selected = records.filter(r => tab === 'all' || r.category === tab).sort((a, b) => (a.completed - b.completed) || ((a.due_date || '9999').localeCompare(b.due_date || '9999'))); $('listTitle').textContent = ({ all: 'All records', job: 'Maintenance', vehicle: 'Vehicles', bill: 'Bills' })[tab]; $('count').textContent = selected.length + ' records'; $('items').replaceChildren(); if (!selected.length) {
        const p = document.createElement('div');
        p.className = 'empty';
        p.textContent = 'Nothing here yet. Add your first record to get started.';
        $('items').append(p);
    } for (const r of selected) {
        const b = document.createElement('button');
        b.className = 'item';
        const left = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small'), pill = document.createElement('span');
        name.textContent = r.title;
        meta.textContent = ({ job: 'Maintenance', vehicle: 'Vehicle', bill: 'Bill' })[r.category] + ' · ' + dateText(r.due_date) + (r.amount !== null ? ' · £' + Number(r.amount).toFixed(2) : '');
        left.append(name, meta);
        pill.className = 'pill' + (r.completed ? ' done' : days(r.due_date) !== null && days(r.due_date) < 0 ? ' late' : '');
        pill.textContent = r.completed ? 'Completed' : days(r.due_date) !== null && days(r.due_date) < 0 ? 'Overdue' : 'Open';
        b.append(left, pill);
        b.onclick = () => edit(r);
        $('items').append(b);
    } }
    function selectTab(value) {
        if (!['all', 'job', 'vehicle', 'bill', 'reminders', 'documents', 'calendar', 'notifications'].includes(value))
            return;
        tab = value;
        for (const button of $('tabs').querySelectorAll('button')) {
            button.classList.toggle('active', button.dataset.tab === tab);
            button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
        }
        render();
        if (tab === 'documents')
            documents.refresh();
        if (['calendar', 'notifications'].includes(tab))
            ensureCalendar().catch(error => toast(error.message));
    }
    $('tabs').onclick = event => { const button = event.target.closest('button[data-tab]'); if (button)
        selectTab(button.dataset.tab); };
    function edit(r) { $('recordForm').reset(); $('recordId').value = r?.id || ''; $('editorTitle').textContent = r ? 'Edit record' : 'New record'; $('category').value = r?.category || (['job', 'vehicle', 'bill'].includes(tab) ? tab : 'job'); $('title').value = r?.title || ''; $('due').value = r?.due_date || ''; $('amount').value = r?.amount ?? ''; $('notes').value = r?.notes || ''; $('done').checked = r?.completed || false; $('delete').hidden = !r; $('editor').showModal(); }
    $('add').onclick = () => edit(null);
    $('close').onclick = () => $('editor').close();
    $('recordForm').onsubmit = async (e) => { e.preventDefault(); const id = $('recordId').value; const data = { category: $('category').value, title: $('title').value.trim(), due_date: $('due').value || null, amount: $('amount').value === '' ? null : Number($('amount').value), notes: $('notes').value.trim(), completed: $('done').checked }; if (!user || !data.title || recordBusy === generation)
        return; if (!navigator.onLine) {
        toast('Connect to the internet before saving.');
        return;
    } if (data.amount !== null && (!Number.isFinite(data.amount) || data.amount < 0 || data.amount > 99999999.99)) {
        toast('Enter a valid amount');
        return;
    } const version = generation; recordBusy = version; const save = $('recordForm').querySelector('button:not([type]),button[type=submit]'); save.disabled = true; let q = id ? db.from('records').update(data).eq('id', id).eq('user_id', user.id).select('id').single() : db.from('records').insert({ ...data, user_id: user.id }).select('id').single(); try {
        const { error } = await q;
        if (version !== generation)
            return;
        if (error)
            throw error;
        $('editor').close();
        await load();
    }
    catch (error) {
        if (version === generation)
            toast(error.message);
    }
    finally {
        if (version === generation) {
            recordBusy = null;
            save.disabled = false;
        }
    } };
    $('delete').onclick = async () => {
        const id = $('recordId').value;
        if (!user || !id || recordBusy === generation || !confirm('Delete this record permanently?'))
            return;
        const version = generation;
        recordBusy = version;
        $('delete').disabled = true;
        try {
            const { error } = await db.from('records').delete().eq('id', id).eq('user_id', user.id).select('id').single();
            if (version !== generation)
                return;
            if (error)
                throw error;
            $('editor').close();
            await load();
        }
        catch (error) {
            if (version === generation)
                toast(error.message);
        }
        finally {
            if (version === generation) {
                recordBusy = null;
                $('delete').disabled = false;
            }
        }
    };
    function renderSection() {
        $('recordArea').hidden = ['documents', 'reminders', 'calendar', 'notifications'].includes(tab);
        $('documentsArea').hidden = tab !== 'documents';
        $('reminderArea').hidden = tab !== 'reminders';
        $('calendarArea').hidden = tab !== 'calendar';
        $('notificationsArea').hidden = tab !== 'notifications';
        $('add').hidden = ['documents', 'calendar', 'notifications'].includes(tab);
        if (tab !== 'reminders')
            return;
        const list = $('reminderList');
        list.replaceChildren();
        const reminders = maintenanceReminders(records);
        if (!reminders.length) {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'You are up to date. Set a due date on a maintenance job to see a reminder here.';
            list.append(empty);
        }
        for (const record of reminders) {
            const card = document.createElement('article');
            card.className = 'documentItem';
            const title = document.createElement('strong');
            title.textContent = record.title;
            const detail = document.createElement('p');
            const remaining = dayDifference(record.due_date);
            detail.textContent = (remaining < 0 ? 'Overdue' : remaining === 0 ? 'Due today' : 'Due in ' + remaining + ' days') + ' · ' + dateText(record.due_date);
            const actions = document.createElement('div');
            actions.className = 'actions';
            const editButton = document.createElement('button');
            editButton.textContent = 'Update job';
            editButton.onclick = () => edit(record);
            const calendar = document.createElement('button');
            calendar.className = 'secondary';
            calendar.textContent = 'Add to calendar';
            calendar.onclick = async () => { const version = generation, owner = user?.id; let preferences = DEFAULTS; try {
                const repo = calendarRepositoryFactory ? calendarRepositoryFactory(owner) : new SupabaseCalendarRepository(db, owner);
                preferences = await repo.preferences();
            }
            catch { } if (version !== generation || owner !== user?.id)
                return; downloadBlob(new Blob([calendarReminder(record, new Date(), preferences)], { type: 'text/calendar;charset=utf-8' }), 'HomeHub-reminder.ics'); };
            actions.append(editButton, calendar);
            card.append(title, detail, actions);
            list.append(card);
        }
    }
    const tabletButton = document.createElement('button');
    tabletButton.textContent = 'Tablet Mode';
    tabletButton.type = 'button';
    tabletButton.id = 'tabletMode';
    $('dashboard').querySelector('.welcome').append(tabletButton);
    tabletButton.onclick = () => {
        if (!user) return;
        if (!tablet) tablet = mountTablet(calendarRepositoryFactory ? calendarRepositoryFactory(user.id) : new SupabaseCalendarRepository(db, user.id), () => tabletButton.focus());
        tablet.open();
    };
    await init();
    return { refresh: load, selectTab, state: () => ({ user: user ? { id: user.id, email: user.email } : null, records: structuredClone(records), tab }), destroy() { disposed = true; sessionSequence++; authSubscription?.unsubscribe(); for (const timer of timers)
            window.clearInterval(timer); for (const [type, fn] of windowListeners)
            window.removeEventListener(type, fn); clearPrivateState(); user = null; } };
}
