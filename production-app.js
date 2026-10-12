import { mountHomeHub } from './app.js';
// Existing HomeHub production project; browser publishable key only.
const client = window.supabase.createClient(
 'https://ejshqohrnsdmzinvqqzz.supabase.co',
 'sb_publishable_JpXxDZ9SYISJn4QKeNxEHw_WRuxbtJd',
 { auth: { persistSession: true, autoRefreshToken: true } }
);
mountHomeHub(client, {notificationOptions: {vapidPublicKey: 'BG0NNVWFy6mGsJIHbGPj8kqk2a39svngluHOEchQ0qkZtiacOakdOiq49TRrhAhstVoXULYfL6awExV40sDXUpc', invoke: async (body) => {const {data,error}=await client.functions.invoke('homehub-push-subscription',{body});if(error)throw error;if(data?.error)throw Error(data.error);return data;}}}).catch(error => {
 console.error('HomeHub failed to start', error);
 document.getElementById('launchScreen').hidden = true;
 document.getElementById('setup').hidden = false;
 document.getElementById('setup').textContent = 'HomeHub could not start. Please reload.';
});
