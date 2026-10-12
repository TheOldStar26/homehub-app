# HomeHub calendar reminders

In Calendar, choose **Add event** or open an existing event. **Event reminders** appears after the event times, before timezone and recurrence.

Timed events support event time, 5, 10, 15, 30 minutes, 1 hour, 12 hours and 1 day, plus longer presets. Choose **Choose multiple reminders** to tick several offsets, or enter custom minutes separated by commas. Up to ten offsets are allowed. All-day events keep their existing behaviour: offsets are days, delivered at 09:00 in the event's timezone. **Off** disables this event; **Category defaults** uses the settings in Notifications.

Reminders are stored in `public.calendar_events.reminders`: null means category defaults, an empty array means off, and an array contains explicit offsets. Existing legacy `reminder` values continue to be read. The global notification preference must be enabled; explicit event overrides can override a disabled category default.

## iPhone

Use the original app at https://theoldstar26.github.io/homehub-app/. Add it to the Home Screen using Safari's Share menu and launch the Home Screen app. In Notifications, enable notifications for that device. iOS 16.4 or later is required. See [Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

After an update, close all HomeHub windows and reopen the Home Screen app so the waiting service worker can activate. An already-open editor is never forcibly refreshed. Do not clear website data or reinstall merely to update.

For a real delivery test, create a timed event a few minutes ahead with two reminders (for example one minute before, using Custom, and event time). Close HomeHub and lock the phone. Confirm both notifications appear, then tap one to open the event. The editor's **Test notification tap** button only tests a local notification; it does not prove server delivery. Device Focus modes, Scheduled Summary and notification settings can affect presentation.

## Backend and security

These function sources target only HomeHub, project `ejshqohrnsdmzinvqqzz`. The separate Old Star DJ project is not involved.

- `homehub-push-subscription` validates the signed-in user with Supabase Auth and limits writes to that user. CORS supports the Supabase SDK. Only recognised HTTPS push-service destinations and correctly sized browser encryption keys are accepted.
- `homehub-reminder-sender` derives the public VAPID key using `node:crypto` from the existing `VAPID_PRIVATE_KEY` Edge Function secret. Neither private VAPID keys nor scheduler credentials belong in this repository.
- The existing cron job retains its historical name `homehub-reminders-every-five-minutes`, but now runs **every minute**. Its token is generated inside PostgreSQL, stored in Vault, and verified by a service-role-only RPC. The sender intentionally uses custom scheduler authentication, with gateway JWT verification disabled. The subscription function retains gateway JWT verification and user validation.
- Authenticated scheduler requests can use `{ "action": "health", "expectedPublicKey": "<browser public VAPID key>" }` to receive a boolean key-match result. The private key is never returned.
- An atomic primary-key claim in `homehub_notification_deliveries` suppresses concurrent/repeated sends. Its key identifies the subscription, event occurrence and reminder instant. Editing an event title does not resend already delivered reminders. Temporary push failures release the claim for retry; expired subscriptions are removed.
- Delivery uses a six-minute lookback. Long outages can miss older reminders. A process crash after claiming a reminder, or an ambiguous provider timeout, cannot guarantee exactly-once delivery. Notification tags remain stable across retries. Provider acceptance alone does not prove display on an iPhone.
- Ownership RLS on events and preferences remains enabled. Browser roles cannot access delivery markers or scheduler authentication. No event/account data is migrated or removed by the scheduler migration.

## Verification

Run `npm ci`, `npm test` and `npm run check` with Node.js 20 or newer. Tests cover reminder editing/persistence, defaults, recurrence/DST, sender retries/deduplication, push validation, realtime lifecycle and background service-worker handling. Release checks verify syntax, cached assets, shared browser/sender scheduling rules and accidental credential patterns.

`tests/hosted-reminder-security.sql` is an administrator-run, rollback-only integration check on the intended HomeHub database. It tests reminder CRUD and cross-owner isolation without retaining synthetic rows. Deploy the migration and the two functions only after confirming the HomeHub project reference; never rotate the VAPID private key to resolve an import error, as that would invalidate existing device subscriptions.
