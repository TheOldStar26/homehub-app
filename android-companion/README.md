# HomeHub Companion — Phase 1

This is a separate Kotlin Android project loading the existing HTTPS HomeHub website.
No hosted website files or Supabase schemas are changed. This foundation does **not**
listen for “Hey HomeHub”: the supplied wake engine is deliberately unavailable and
never opens the microphone. No microphone service runs in the background.

## Build

Open this directory in Android Studio, install SDK platform 35 / Build Tools 35.0.0,
and use JDK 17 and Gradle 8.11.1. Versions are pinned in the Gradle files.
This source package does not include a Gradle wrapper binary. Android Studio can
configure the local Gradle installation, or with Gradle 8.11.1 installed run:

```sh
gradle wrapper --gradle-version 8.11.1 --distribution-type bin
./gradlew :app:assembleDebug :app:lintDebug
```

Expected debug APK: `app/build/outputs/apk/debug/app-debug.apk`.
Install with `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
JDK, Gradle and the Android SDK are absent from the supplied Codex environment;
no APK, Android lint result or device verification is claimed.

## Tablet use

1. Launch HomeHub Companion and sign in. The APK has its own private WebView
   storage; the existing Chrome login cannot transfer automatically. Reopen the
   APK to verify session persistence. The dashboard and calendar are the same site.
2. Open Tablet Mode. Select weather town manually (native geolocation is not wired).
3. Tap the native **Enable tap-to-talk (on-device only)** control. Only this explicit
   action requests Android microphone permission. Then use HomeHub's microphone
   button. Short command recognition is limited to 20 seconds and requires Android's
   on-device recognizer and an installed English language model. If unavailable,
   microphone remains off; the original Chrome app still works as before.
4. The native status shows microphone off, listening, or speaking. **Stop Listening /
   Disable Voice** immediately releases the recognizer, stops audio and disables voice.
   Backgrounding the APK disables voice; it never automatically re-enables.

## Restricted bridge

`voice-adapter.js` runs at document start only in the exact HomeHub origin. It checks
main frame and `/homehub-app/` path, then adapts the browser SpeechRecognition and
speechSynthesis interfaces to native messages. Existing Tablet Mode's `onresult`,
calendar refresh, `answerCommand` and spoken-response logic are reused unmodified.
No separate Supabase client, account tokens, API keys or calendar implementation.

Native messages independently require HTTPS, exact host/port/path, main frame,
foreground activity, version 1, known operations, bounded input and session IDs.
The only operations are ready, one-shot listen, stop, speak and cancelSpeech.
Web microphone/camera permissions are denied. File/content URL access, cleartext,
mixed content, arbitrary navigation and WebView debugging are disabled. TLS errors
fail closed. APK backup is disabled. WebView updates are required for the scoped
message listener and document-start script; without them, native voice is disabled.
No ambient audio is uploaded or stored, and no cloud recognizer fallback is used.
The bridge trusts the HomeHub page's code; it cannot protect against a compromise
of the trusted site itself.

File chooser uploads are wired to Android's picker. Native blob download handling,
external links, native full-screen WebView video/custom views and native geolocation
are outside this foundation; test document downloads before relying on the APK
for them. Browser fullscreen API support can differ from Chrome. Use Chrome for
unsupported flows. The original website and iPhone interface are unchanged.

## Wake engine integration next

Implement `WakeWordEngine` with a locally bundled engine/model such as sherpa-onnx.
Validate model licence, custom wake phrase accuracy, T30Pro CPU/battery use, ambient
noise and false activations on device before exposing a Hands-Free toggle.

Native capture must require fresh user enablement + RECORD_AUDIO + foreground.
After detection, pause wake capture, pass one question through the existing adapter,
then keep capture paused throughout native TTS. Resume only after speech completion
and a short speaker-tail delay, and only while enabled and foreground. On error,
background, page navigation, Stop or destroyed activity, release all audio resources.
A short in-memory pre-roll is needed for a command spoken immediately after the
wake phrase. Clear it on Stop; do not persist recordings. No engine integration or
continuous recording is implemented in Phase 1.

## Checks

```sh
node --test checks/bridge.test.js
```

Tests exercise origin/path/frame rejection, session correlation, late transcript
rejection, speech messages and static native security gates. They are source-level
checks, not Kotlin compilation or on-device integration tests.

Before release, build/lint and test Android 13: persistent login, real calendar/weather,
permission denial, native recognizer/model absence, spoken output, Stop mid-question,
Stop during speech, background/reopen, rotation, offline/TLS failure and uploads.
