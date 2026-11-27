# LPG Leak Monitor – Read-Only Dashboard

Academic prototype (ESP32 + MQ-6 + IR flame sensor + Firebase RTDB). **Not a certified gas or fire alarm.** MQ-6 is uncalibrated; values are raw ADC counts and voltages, never ppm.

## Setup
1. Firebase console → create project → **Build → Realtime Database** → create database.
2. Project settings → **Your apps → Web (</>)** → register app → copy the config.
3. Paste it into `firebase-config.js` (the `databaseURL` looks like `https://<project-id>-default-rtdb.firebaseio.com`).
4. Realtime Database → **Rules** → paste `database.rules.json` → Publish.

## Run locally (not via file://, ES modules need http)
```
python -m http.server 8000     # then open http://localhost:8000
```

## Deploy
- **Firebase Hosting:** `npm i -g firebase-tools`, `firebase login`, `firebase init hosting` (public dir = this folder, single-page = No), `firebase deploy`.
- **GitHub Pages:** push the files, Settings → Pages → deploy from branch.

## Security
- Rules give **public read** on `/LPG_Monitor` (demo only: anyone with the URL can read the data). Restrict reads with Firebase Authentication if needed.
- Writes require `auth != null`. The ESP32 should sign in (e.g. Email/Password user created only for the device, or anonymous auth) and send the ID token with REST calls (`?auth=<idToken>`), refreshing it before it expires (about 1 h).
- The website never writes. **Never commit API keys, device passwords or database secrets to a public repo**; keep device credentials in an untracked `secrets.h`.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Permission denied" | Rules not published, or `.read` not true on `/LPG_Monitor`. |
| "Index not defined… timestamp" warning | Ensure `.indexOn: ["timestamp"]` under `history` is published. |
| Nothing loads / network error | Wrong `databaseURL` (region-specific URLs differ: `...firebasedatabase.app`), or opened via `file://`. |
| Blank cards, "OFFLINE / STALE" | ESP32 is off or not writing; device is ONLINE only if `online` is true and `last_updated` is under 20 s old. Also check the device clock is NTP-synced. |
| Demo data shown | Config still has `YOUR_` placeholders, or Demo mode is ticked. |