# Class Engagement for Google Meet

Opt-in engagement analytics for classes on Google Meet.

- **`extension/`**: Chrome extension students install. It is opt-in, shows a visible badge in Meet, and can be paused.
- **`server/`**: Node server plus the **professor dashboard** (served at `/`).

Students never see the dashboard. They only run the extension, which sends activity data to your server.

---

## Contents

1. [What it tracks](#1-what-it-tracks)
2. [Requirements](#2-requirements)
3. [Fixes to apply before first use](#3-fixes-to-apply-before-first-use)
4. [Quick start (local only)](#4-quick-start-local-only)
5. [Test with fake data](#5-test-with-fake-data)
6. [Go public with Cloudflare Tunnel](#6-go-public-with-cloudflare-tunnel)
7. [Running a class](#7-running-a-class)
8. [Stopping everything](#8-stopping-everything)
9. [Configuration reference](#9-configuration-reference)
10. [Privacy and data](#10-privacy-and-data)
11. [Troubleshooting](#11-troubleshooting)
12. [Known limits](#12-known-limits)
13. [Other ways to deploy](#13-other-ways-to-deploy)

---

## 1. What it tracks

Every 15 seconds each student's extension sends:

| Student's own camera on/off | The student's own camera stream (reliable) |
| Student's own speaking | Loudness of the student's own mic, computed locally (reliable) |
| Whether the Meet tab is in focus | Browser tab state (reliable) |
| Who is in the call, with camera / speaking / hand raised | Read from Meet's page (can break when Meet changes) |
| Chat activity: sender, time label, hash | Read from Meet's chat panel (**never the message text**) |

The dashboard turns this into:

- A **score** per student (0 to 100)
- A **"check in with these students"** list
- A **session strip** per student: one cell per minute (not seen / present / attentive / interacting)
- A **class-wide attention timeline** that shares the same time axis as the strips
- CSV export and one-click deletion of a meeting's data

**How the score works.** Participation (minutes with chat, speaking or a raised hand) is 40%, with 25% of minutes active counting as full marks. Camera-on time is 30%. Meet-tab focus is 30%. Students who don't run the extension are only observed by others, so focus is unknown and the weights become 60% participation and 40% camera. Status labels: 55 and above is *Engaged*, 30 to 54 is *Low engagement*, below 30 is *Disengaged*.

Treat the score as a prompt to check in, **not a grade**. A camera that is off can mean low bandwidth or privacy, and quiet students may still be following along.

---

## 2. Requirements

- Windows, macOS or Linux
- [Node.js](https://nodejs.org/) 18 or newer (check with `node -v`)
- Google Chrome (version 111 or newer)
- [VS Code](https://code.visualstudio.com/) (optional but recommended)
- For the public setup: `cloudflared` (see [section 6](#6-go-public-with-cloudflare-tunnel))

---

## 3. Fixes to apply before first use

Apply these three small edits to the files in your copy.

### 3.1 Camera detection (`server/server.js`)

Find:

```js
const camOn = (b.sc ?? b.cam ?? 0) === 1;
```

Replace with:

```js
const camOn = b.sc === 1 || b.cam === 1;
```

This accepts either the student's own camera signal or the camera seen on their tile. Without it, the first signal can hide the second, and a student's camera can read 0% even when it was on.

### 3.2 Dashboard refresh (`server/public/index.html`)

Find:

```js
timer = setInterval(() => { if (token && current) loadMeeting(); }, 10000);
```

Replace with:

```js
timer = setInterval(() => { if (!token) return; if (current) loadMeeting(); else loadMeetings(); }, 10000);
```

Without it, a dashboard opened before any meeting exists never notices a new meeting until you reload the page.

### 3.3 Allow Cloudflare addresses in the extension (`extension/manifest.json`)

Set `host_permissions` to:

```json
"host_permissions": [
  "https://meet.google.com/*",
  "https://*.trycloudflare.com/*",
  "http://localhost:3000/*"
],
```

Quick tunnels get a new random `*.trycloudflare.com` address every time, so the wildcard avoids editing the manifest each class. After saving, reload the extension at `chrome://extensions`.

### 3.4 Optional: persistent data folder (`server/server.js`)

Only needed on hosts where the working folder is wiped on restart. Find:

```js
const DATA_FILE = path.join(__dirname, 'data.json');
```

Replace with:

```js
const DATA_FILE = path.join(process.env.DATA_DIR || __dirname, 'data.json');
```

---

## 4. Quick start (local only)

All commands below are for **Command Prompt** on Windows. Alternatives for PowerShell and macOS/Linux are in [section 9](#9-configuration-reference).

### 4.1 Open the project in VS Code

1. In VS Code: **File → Open Folder…** and select the extracted `meet-engagement` folder.
2. Open the terminal with **Ctrl+`**. If it isn't Command Prompt, click the **⌄** next to **+** and choose **Command Prompt**.

### 4.2 Install and start the server

```
cd server
npm install
set CLASS_CODE=demo-class
set PROF_TOKEN=dev-token
npm start
```

Rules for `set` in Command Prompt: no spaces around `=`, no quotes, and use only letters, numbers and hyphens.

You should see:

```
Engagement server on http://localhost:3000  (class code: demo-class)
```

Leave this terminal running. Closing it stops the server.

### 4.3 Open the dashboard

Go to <http://localhost:3000>, type `dev-token` in the token box and press **Enter**.

### 4.4 Load the extension

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder.
4. Pin **Class Engagement** from the puzzle-piece menu.
5. Click the extension icon and fill in:
   - **Your name** exactly as Meet shows it
   - **Class code**: `demo-class`
   - **Server URL**: `http://localhost:3000`
   - Tick the **consent** box and click **Save**

### 4.5 Try it in a real call

1. Start a call at <https://meet.new>.
2. A badge "● Sharing engagement as *your name*" appears at the bottom-left.
3. Turn your camera on, speak, open the chat panel and send a message, and switch to another tab for a couple of minutes.
4. Your row appears on the dashboard within about 30 seconds.

---

## 5. Test with fake data

This checks the server and dashboard without Google Meet.

Create `server/seed.js`:

```js
const url = 'http://localhost:3000/api/snapshot';   // for a tunnel, use https://YOUR-ADDRESS.trycloudflare.com/api/snapshot
const post = b => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-class-code': 'demo-class' },   // must match CLASS_CODE
  body: JSON.stringify(b),
}).then(r => console.log('sent', r.status));

const roster = [
  { name: 'Alice Reyes', cam: true,  spk: true,  hand: false },
  { name: 'Bob Cruz',    cam: false, spk: false, hand: false },
];
let i = 0;
function tick() {
  post({ meetingCode: 'abc-defg-hij', reporter: 'Alice Reyes',
    self: { camOn: true, speakingSec: i % 2 ? 4 : 0, focused: true }, roster,
    chat: i % 3 === 0 ? [{ sender: 'Alice Reyes', time: '10:0' + (i % 10), hash: 'h' + i }] : [] });
  post({ meetingCode: 'abc-defg-hij', reporter: 'Bob Cruz',
    self: { camOn: false, speakingSec: 0, focused: false }, roster, chat: [] });
  i++;
}
tick();
setInterval(tick, 15000);
```

In a **second terminal**:

```
cd server
node seed.js
```

You should see `sent 200` every 15 seconds. After 3 to 5 minutes, the dashboard shows Alice with a high score and Bob as *Disengaged* and under "Check in with these students". Stop it with **Ctrl+C** and click **Delete this meeting's data** on the dashboard.

`sent 401` means the class code in `seed.js` doesn't match the server's `CLASS_CODE`.

---

## 6. Go public with Cloudflare Tunnel

This makes the server running on your laptop reachable by students over HTTPS, at no cost and without a hosting account.

### 6.1 What you need to know first

- **Free, no account, no credit card.** Quick tunnels need no Cloudflare account or domain.
- **Testing and development only.** Cloudflare describes quick tunnels as intended for testing and development, with no uptime guarantee. This is a good fit for a pilot, but don't rely on it for high-stakes classes.
- **Limit of 200 in-flight connections.** Each student sends one short report every 15 seconds, so a normal class is well within it.
- **A new address every time.** The address (`https://random-words.trycloudflare.com`) lasts only while the tunnel runs. Students must paste the new one into the extension for each session.
- **Your laptop is the server.** If it sleeps, loses internet or shuts down, reporting stops. Data stays safe in `server/data.json`.
- These are the terms as of writing. They can change, so check Cloudflare's current documentation.

### 6.2 Install `cloudflared` (one time)

In Command Prompt:

```
winget install --id Cloudflare.cloudflared
```

**Close VS Code completely and reopen it**, then check:

```
cloudflared --version
```

If it isn't recognised:

- Download `cloudflared-windows-amd64.exe` from <https://github.com/cloudflare/cloudflared/releases>, put it in the `server` folder, rename it `cloudflared.exe`, and run it as `cloudflared.exe` from that folder.
- Or run it by full path, usually `"C:\Program Files (x86)\cloudflared\cloudflared.exe"`.
- If Windows SmartScreen warns you, use **More info → Run anyway**, but only for the file from the official release page.

macOS: `brew install cloudflared`. Linux: see Cloudflare's install instructions.

### 6.3 Start the server with real codes

Pick your own values. **Do not use `demo-class` or `dev-token` on a public address.**

Generate a strong token:

```
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Then, in **Terminal 1**:

```
cd server
set CLASS_CODE=bio101-fall26-x7k2
set PROF_TOKEN=<paste-your-generated-token>
npm start
```

### 6.4 Start the tunnel

In **Terminal 2** (click **⌄** next to **+** and choose Command Prompt):

```
cloudflared tunnel --url http://localhost:3000
```

Keep `localhost:3000` here, because it tells the tunnel where your server is running.

After a few seconds a box shows your address:

```
https://some-random-words.trycloudflare.com
```

Copy it. It can take up to a minute to become reachable.

If the tunnel can't connect, try forcing the connection type:

```
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

If that still fails, turn off any VPN, or try your phone's hotspot, because some school and work networks block it.

### 6.5 Check it from outside

1. Open the tunnel address in Chrome, enter your `PROF_TOKEN`, and confirm the dashboard loads.
2. Open the same address on your phone using **mobile data** (Wi-Fi off). If it loads, it works from outside your network.
3. Optional API check:
   ```
   curl -s -w " HTTP %{http_code}" -X POST https://YOUR-ADDRESS.trycloudflare.com/api/snapshot -H "x-class-code: YOUR-CLASS-CODE" -H "content-type: application/json" -d "{}"
   ```
   - `{"error":"bad payload"} HTTP 400` means the tunnel and class code are correct. The empty body is rejected on purpose.
   - `HTTP 401` means the class code doesn't match.

### 6.6 Point the extension at the tunnel

Make sure you applied [fix 3.3](#33-allow-cloudflare-addresses-in-the-extension-extensionmanifestjson) and reloaded the extension. Then click the extension icon and set:

| Field | Value |
|---|---|
| Server URL | the tunnel address, starting with `https://`, with **no `/` at the end** |
| Class code | your `CLASS_CODE` (for example `bio101-fall26-x7k2`) |
| Your name | exactly as Meet shows it |
| Consent | ticked, then **Save** |

### 6.7 Prepare your laptop for class

- Set Windows to never sleep while plugged in: Settings → System → Power → Screen and sleep.
- Stay on a stable connection and keep the laptop plugged in.
- Start the server and tunnel about 10 minutes before class, and test with your own extension.

### 6.8 Security notes

- While the tunnel runs, **anyone with the address can reach your server**. The class code limits who can send data, and the token limits who can read it, so use long, random values.
- Don't post the address publicly, and always shut the tunnel down after class.
- If the class code leaks, stop the server, restart it with a new `CLASS_CODE`, and send the new one to students.

---

## 7. Running a class

### 7.1 What students need

Send each student:

1. The `extension` folder (zipped).
2. The tunnel address (new each session) and the class code.
3. These install steps:
   1. Unzip the folder.
   2. Open `chrome://extensions` and turn on **Developer mode**.
   3. Click **Load unpacked** and select the folder.
   4. Click the extension icon and enter your name (as shown in Meet), the class code and the server address.
   5. Tick the consent box and click **Save**.
4. A short privacy notice (see [section 10](#10-privacy-and-data)).

On later sessions, students only paste the new server address and click **Save**.

### 7.2 Class code vs. Meet code vs. dashboard token

| | Example | Who sets it | Who uses it |
|---|---|---|---|
| **Class code** | `bio101-fall26-x7k2` | You (`CLASS_CODE`) | Every student, in the extension |
| **Meet code** | `abc-defg-hij` | Google | Nobody types it. The extension reads it from the page, and it's how meetings are listed in the dashboard. |
| **Dashboard token** | `7f3a9c2e…` | You (`PROF_TOKEN`) | Only you, on the dashboard |

Never give students the dashboard token.

### 7.3 During class

1. Open the dashboard at the tunnel address and enter your token.
2. Choose the meeting (its Meet code) from the dropdown. The page refreshes every 10 seconds.
3. Keep the **chat panel open** (you or a TA). Chat can only be read while someone running the extension has the panel open, and messages are de-duplicated on the server.

### 7.4 Reading the dashboard

- **Strip colors:** dashed = not seen, grey = present, medium green = attentive (camera on, tab in focus), bright green = interacting (chat, speaking or hand raised).
- **"Check in with these students"** lists students with no chat, speaking or raised hand for 10 or more minutes, or whose Meet tab was out of focus for 90 or more seconds.
- **An asterisk (*) beside a name** means that student isn't running the extension, so tab focus is unknown.
- **After the meeting ends**, students show as "Left the call" after about 45 seconds. Scores freeze, and the meeting stays available for review and export.
- **Reusing the same Meet link** merges sessions into one record. Export and delete between classes, or use a new link.

---

## 8. Stopping everything

| To stop | How |
|---|---|
| **Tunnel** (Terminal 2) | Click in the terminal, press **Ctrl+C**. Red `ERR` lines such as "Connection terminated" during shutdown are normal. |
| **Server** (Terminal 1) | Click in the terminal, press **Ctrl+C**, type `Y` if asked. |
| **Lost the terminal?** | See below |

Find and stop a server that's still holding port 3000:

```
netstat -ano | findstr :3000
taskkill /PID <number-from-the-LISTENING-line> /F
```

Stop a tunnel by name:

```
taskkill /IM cloudflared.exe /F
```

Your data stays in `server/data.json` and is there when you restart. Stopping the tunnel makes the public address stop working immediately.

---

## 9. Configuration reference

### Environment variables (server)

| Variable | Default | Purpose |
|---|---|---|
| `CLASS_CODE` | `demo-class` | Shared code students enter in the extension |
| `PROF_TOKEN` | `change-me` | Token the professor enters on the dashboard |
| `PORT` | `3000` | Server port |
| `RETENTION_DAYS` | `30` | Meetings older than this are deleted automatically |
| `DATA_DIR` | server folder | Where `data.json` is stored (requires [fix 3.4](#34-optional-persistent-data-folder-serverserverjs)) |

### Setting variables per shell

| Shell | Example |
|---|---|
| Command Prompt | `set CLASS_CODE=abc` then `set PROF_TOKEN=xyz` then `npm start` |
| PowerShell | `$env:CLASS_CODE="abc"; $env:PROF_TOKEN="xyz"; npm start` (if scripts are blocked, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use `npm.cmd`) |
| macOS / Linux | `CLASS_CODE=abc PROF_TOKEN=xyz npm start` |

The values only last for that terminal window, so set them again each time you restart.

### API endpoints (for reference)

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/snapshot` | `x-class-code` header | Student extension reports |
| `GET /api/meetings` | `x-prof-token` header | List meetings |
| `GET /api/meetings/:code` | `x-prof-token` | Full analytics for a meeting |
| `GET /api/meetings/:code/export.csv` | `x-prof-token` | CSV export |
| `DELETE /api/meetings/:code` | `x-prof-token` | Delete a meeting's data |

---

## 10. Privacy and data

**Collected:** name, when the student is in the call, camera on/off, speaking, Meet-tab focus, the call roster (name, camera, speaking, hand), and chat metadata (sender, time label, hash).

**Never collected:** message text, audio, video, screen content, or other tabs.

Good practice:

- Tell students what's collected and why (for example in the syllabus), and keep participation opt-in.
- Don't use scores as the sole basis for grading or discipline.
- Check your institution's policy and local privacy rules (FERPA, GDPR or equivalent).
- Data is deleted automatically after `RETENTION_DAYS`, or on demand with **Delete this meeting's data** on the dashboard. Export a CSV first if you need a record.
- Use long random values for the class code and token, and don't reuse the examples in this README.

---

## 11. Troubleshooting

### Server and dashboard

| Problem | Fix |
|---|---|
| `npm` blocked in PowerShell ("running scripts is disabled") | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or switch the terminal to Command Prompt, or use `npm.cmd`. |
| `EADDRINUSE` when starting | An old server is running. Use the `netstat` / `taskkill` commands in [section 8](#8-stopping-everything). |
| `sent 401` or server returns 401 | The class code doesn't match `CLASS_CODE`. Check the startup line. Look for quotes or trailing spaces and run `echo [%CLASS_CODE%]` to check. |
| "Token not accepted" | The dashboard token must match `PROF_TOKEN` exactly. Press **Enter** after typing it. |
| "No meetings yet" | The server hasn't received data. Apply [fix 3.2](#32-dashboard-refresh-serverpublicindexhtml) and reload. Check that you're inside the call (not the waiting screen). |
| Camera shows 0% though it was on | Apply [fix 3.1](#31-camera-detection-serverserverjs). A very short camera-on time can also round to 0%, so test with a couple of minutes. |
| Speaking shows even when muted | Raise `SPEAK_LEVEL` in `extension/content.js` from `0.02` to about `0.05`, reload the extension, and refresh Meet. |

### Cloudflare tunnel

| Problem | Fix |
|---|---|
| `cloudflared` is not recognised | Fully restart VS Code after installing. Otherwise use `cloudflared.exe` in the `server` folder or the full path ([6.2](#62-install-cloudflared-one-time)). |
| Tunnel can't connect / keeps retrying | Add `--protocol http2`, turn off any VPN, or try your phone's hotspot. |
| Address shows an error right after starting | Wait 30 to 60 seconds and refresh. Check the server is still running in Terminal 1. |
| Dashboard loads but extension says "server unreachable" | The Server URL must be the exact current address, start with `https://`, and have no trailing `/`. Confirm [fix 3.3](#33-allow-cloudflare-addresses-in-the-extension-extensionmanifestjson) was applied and the extension reloaded. |
| Students suddenly can't connect | The tunnel restarted, so the address changed. Send the new one. |

### Extension and Meet

| Problem | Fix |
|---|---|
| No badge in Meet | Reload the extension at `chrome://extensions`, then refresh the Meet tab. Check the consent box is ticked and saved. |
| Badge is green but the dashboard is empty | The badge starts green and only turns red after a failed send. Check the class code, Server URL, and that you're inside the call. |
| Still empty | In the Meet tab press **F12 → Console** and run `document.querySelectorAll('[data-participant-id]').length`. If it prints `0`, Meet's page layout differs from what the extension expects. See below. |
| Errors from the extension | At `chrome://extensions`, click **service worker** on the extension's card and read the Console. `Failed to fetch` points at the Server URL or permissions. |

**Debugging camera and mic detection.** In the Meet tab Console, paste this and toggle your camera and mic. It prints one line per second:

```js
window.addEventListener('message', e => { if (e.data?.source === 'class-engagement') console.log('cam:', e.data.cam, 'mic:', e.data.mic, 'level:', e.data.level.toFixed(3)) })
```

If `cam:` never becomes `true` while your camera is on, `inject.js` isn't seeing Meet's camera stream.

---

## 12. Known limits

- **Meet has no public real-time API for this**, so the extension reads Meet's page, and Meet changes it without notice. All selectors are in the `SEL` block at the top of `extension/content.js`, so expect to tune them. The most fragile parts are the speaking indicator on *other people's* tiles, the hand-raised icon, and chat sender parsing. A student's own mic, camera and tab-focus signals don't depend on Meet's markup.
- **Chat is only readable while someone running the extension has the chat panel open.**
- **Camera-off, quiet and tab-away are weak proxies for disengagement.** Use the dashboard to decide who to check in with.
- **Auth is basic:** one shared class code and one professor token. That's fine for a pilot, but add sign-in (for example Google) and per-class codes before wider use. One server shares one class code across all courses.
- **Changing the class code requires a server restart**, after which students update their extension.
- **Students install by "Load unpacked"** in this setup. For a whole class or school, publish to the Chrome Web Store (unlisted) or have IT install it by policy.
- **A laptop-hosted tunnel** depends on your laptop staying on and awake, and on Cloudflare's free quick-tunnel service, which has no uptime guarantee.

### Sturdier option for Google Workspace for Education

The **Meet REST API** (participants, join/leave sessions, transcripts) and the **Meet Add-ons SDK** give official, stable data without scraping. This system could use them for attendance and keep the extension only for tab-focus and mic/camera signals.

---

## 13. Other ways to deploy

Check each provider's current terms, since free tiers change often.

| Option | Always on? | Keeps data? | Notes |
|---|---|---|---|
| **Laptop + Cloudflare quick tunnel** (this README) | While laptop is on | Yes | Free; best for a pilot |
| **Oracle Cloud Always Free VM** | Yes | Yes | Free; needs a card for verification and some sysadmin work |
| **Google Cloud e2-micro** | Yes | Yes | Free in certain regions only; some sysadmin work |
| **Render free tier** | No (sleeps after 15 min idle) | **No** (ephemeral disk) | Export CSV right after each class |
| **Render / Railway / small VPS (paid)** | Yes | Yes (with disk or volume) | Small monthly cost |

Whichever host you use, it **must serve HTTPS**. Add the host's address to `host_permissions` in `extension/manifest.json`, and set the server address defaults in `popup.js` and `background.js` so students only enter their name and class code. Serverless platforms (Netlify, Vercel functions) are a poor fit, because the server keeps state in memory and writes one file.

### A permanent tunnel address

Cloudflare's named tunnels give a fixed address, but they need a free Cloudflare account and a domain whose DNS is on Cloudflare (domains normally cost money).

---

## Project layout

```
meet-engagement/
├── README.md
├── extension/
│   ├── manifest.json     Permissions and script registration
│   ├── inject.js         Reads the student's own mic level and camera state
│   ├── content.js        Reads Meet's page, sends reports, shows the badge
│   ├── background.js     Relays reports to the server
│   ├── popup.html/js     Name, class code, server URL and consent
├── server/
│   ├── package.json
│   ├── server.js         Ingest, scoring, API, data.json storage
│   └── public/index.html Professor dashboard
```

## Ideas for next steps

- A dashboard settings page with multiple classes, each with its own generated class code
- Google sign-in for professors, so each sees only their own classes
- Pre-filled server address and class code through Chrome managed storage, so students never type them
- A student-facing view of their own engagement
- Rate limiting and an external database for larger deployments