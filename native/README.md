# Haven Pro native app — background-location spike

**Draft prototype. Not for the App Store, Google Play, or anyone's phone but the founder's.**
Approved by the founder on 2026-11-10 as a limited prototype. It answers one question:
*does Haven Pro keep sending real, authenticated location updates while the phone is locked
or another app (Apple Maps / Google Maps) is in front?*

The web app (GitHub Pages) is unchanged. This folder wraps the same compiled app in
Capacitor so it can use native background location.

| Piece | Version | Why |
| --- | --- | --- |
| Capacitor (core, ios, android, cli) | 8.6.0 (Oct 28, 2026) | Current stable |
| @capacitor-community/background-geolocation | 1.3.1 (Oct 22, 2026), MIT, free | Native GPS that keeps running in the background |
| @capacitor/geolocation | 8.2.4 | Only to ask iPhone for "While Using" permission |
| Node | 22 or newer | Capacitor 8 requirement |
| Xcode | 26 or newer | Capacitor 8 requirement |

How it works: the app's existing en-route watch (Pro #75) gets its positions from the plugin
instead of the browser, and the live POST to `pro_update_live_location` goes through
Capacitor's native HTTP. #75's rules are unchanged: 10 s cadence when moving and a 30 s
heartbeat, 10/20/30 s retries, stop on refusal, Arrived, sign-out or permission loss, and no
history. Nothing about the backend changes.

## On your Mac: iPhone build (about 15 minutes the first time)

You need Xcode 26+, Node 22+, your iPhone and its cable.

```sh
git clone https://github.com/bluspots/haven-pro.git   # or: cd haven-pro && git fetch
cd haven-pro
git checkout claude/pro-native-bg-location-spike
cd native
npm ci
npm run ios            # builds the web app, copies it in, opens Xcode
```

In Xcode:

1. Select **App** (left sidebar, top) → **Signing & Capabilities**.
2. **Team:** choose your Apple ID (a free "Personal Team" works for your own phone; builds last 7 days).
   If Xcode says the bundle ID is taken, change `app.haven.pro.spike` to e.g. `app.haven.pro.spike.alex`.
3. Check **Background Modes → Location updates** is listed and ticked. If Background Modes is
   missing, press **+ Capability**, add it, and tick **Location updates**.
4. Plug in the iPhone. On the phone: **Settings → Privacy & Security → Developer Mode → On** (restarts).
5. Pick your iPhone at the top of Xcode and press **Run (▶)**.
6. First launch with a personal team: on the phone, **Settings → General → VPN & Device Management**
   → trust your developer profile, then open Haven Pro again.

## Android build

A debug APK was already built from this branch (it compiles against Capacitor 8.6.0). To build it yourself:

```sh
cd haven-pro/native
npm ci
npm run android        # opens Android Studio → Run on a connected phone
```

To install the APK file directly: copy `app-debug.apk` to the phone, open it, and allow
"Install unknown apps" for that one install.

On Android 13+, allow notifications for Haven Pro (Settings → Apps → Haven Pro → Notifications)
so the "Sharing your location…" notification is visible. The spike doesn't ask for this yet.

## The drive test (go/no-go)

Customer side: the Customer screen must show the #96 build. Until #96 is merged, run it on your Mac:

```sh
git clone https://github.com/bluspots/bluspots.github.io.git customer   # or fetch
cd customer && git checkout claude/customer-live-location-view
python3 -m http.server 8080
```

Open `http://localhost:8080/index.html` on the Mac. Sign in as the existing QA Customer yourself,
and open that job's tracking screen. The map picture may not load from `localhost` (hub item
G10), but the status line ("Waiting…", "Updated … ago", "Location paused…") is what matters.
Start a QuickTime screen recording of it before you leave.

Pro side, on the phone:

1. Sign in as the existing QA Pro (you type the password; nobody else does).
2. Accept the QA job, or open the job that is already en route. Allow location **While Using the App**
   and keep **Precise Location** on.
3. On the job screen, check the green notice ("Sharing your location with this customer until you arrive.")
   and the dashed **Background test** panel under it. The panel only counts things; it never shows
   coordinates.
4. **Lock the phone** and drive about 15 minutes.
5. Unlock, start **Google Maps or Apple Maps** navigation from Haven's link, and drive about 15 more
   minutes with the maps app in front and the phone locked again.
6. Back in Haven Pro, photograph the Background test panel, then tap **I've Arrived**.

**Pass:** the panel shows sends accepted **while in background**, and "Longest gap between accepted
sends (in background)" is about 30 s or less. On the recording, the Customer's "Updated … ago"
stays under about 30 s while driving with good signal.

**What the panel tells us if it fails:**

- **Positions received in background = 0:** the app's code doesn't run while the phone is locked.
  The fix is a small native sender (Swift/Kotlin) that posts to the same `pro_update_live_location`.
- **Positions in background > 0 but accepted in background = 0:** the HTTP request is the problem.
- **Big gaps only while parked:** the 30 s heartbeat timer is being slowed. That's expected to be
  minor; we record it.

Also note: battery % at start and end, whether the iPhone showed the blue location pill (and on
Android the notification), and anything odd.

## What the spike does not do yet

- **No store builds.** The app ID is a placeholder (`app.haven.pro.spike`).
- **Libraries still load from the internet.** React, ReactDOM and supabase-js come from CDNs; the
  next step would bundle them.
- **Two prompts are missing.** No Android notification-permission prompt, and no "precise location
  is off" message (that needs copy approval).
- **The Mapbox token may refuse the app's `localhost` address.**
- **Force-quit, phone restarts, revoked permission, and some Android makers' battery savers stop
  tracking.** No app can prevent these; the Customer sees "paused" after 5 minutes.
