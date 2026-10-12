import { mountHomeHub } from './app.js';
// Existing HomeHub production project; browser publishable key only.
const client = window.supabase.createClient(
 'https://ejshqohrnsdmzinvqqzz.supabase.co',
 'sb_publishable_JpXxDZ9SYISJn4QKeNxEHw_WRuxbtJd',
 { auth: { persistSession: true, autoRefreshToken: true } }
);
mountHomeHub(client).catch(error => {
 console.error('HomeHub failed to start', error);
 document.getElementById('launchScreen').hidden = true;
 document.getElementById('setup').hidden = false;
 document.getElementById('setup').textContent = 'HomeHub could not start. Please reload.';
});
