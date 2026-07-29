# LAN Chat

A simple self-hosted chat app for you and your friends. Works two ways:

- **Local network mode**: run it on your laptop, friends on the same Wi-Fi connect to it. (No internet needed, but your laptop has to stay on.)
- **Cloud mode**: deploy it once to a free hosting service, and everyone connects over the internet — no computer has to stay running. See "Deploy it to the cloud" below.

## Requirements
- [Node.js](https://nodejs.org) installed (v16 or newer) — only needed if running locally.

## Running it locally
1. Unzip this folder, open a terminal in it, run:
   ```
   npm install
   ```
2. Start it:
   ```
   node server.js
   ```
   You'll see:
   ```
   LAN Chat server running!
     Local:   http://localhost:3000
     Network: http://192.168.1.42:3000   <-- share this with friends on your LAN
   ```
3. Send the **Network** address to friends on the same Wi-Fi/router.

To use a different port: `PORT=8080 node server.js` (Windows CMD: `set PORT=8080 && node server.js`; PowerShell: `$env:PORT=8080; node server.js`)

## Deploy it to the cloud (so your laptop doesn't need to run it)
This puts the app on a free hosting service ([Render](https://render.com)) so it's always reachable at one URL, from anywhere with internet — not just your home network.

1. **Put the code on GitHub** (Render deploys from a repo):
   - Create a free GitHub account if you don't have one.
   - Create a new repository, e.g. `lan-chat`.
   - Upload all the files in this folder to that repo (drag-and-drop on github.com works, or use `git push` if you're comfortable with git).

2. **Create a free Render account** at [render.com](https://render.com) and sign in (you can sign in with GitHub).

3. **New → Blueprint**, then pick your `lan-chat` repo. Render will read the included `render.yaml` and set everything up automatically (build command, start command, free plan). Click **Apply** / **Create**.

4. Wait a minute or two for the first build. Render will give you a URL like `https://lan-chat-xyz.onrender.com` — that's the link everyone uses, from any device, anywhere.

**Things to know about the free tier:**
- The free instance goes to sleep after ~15 minutes of no traffic, and takes ~30-50 seconds to wake back up on the next visit. Fine for casual friend use, just expect a short delay after quiet periods.
- Accounts (`users.json`) live on the instance's disk, which is wiped on redeploys (e.g. if you push code changes later) but survives normal sleep/wake cycles. If you push an update, friends may need to re-register.
- The app is now reachable by anyone with the link, not just people on your Wi-Fi — the username/password login is what keeps it private, so don't share the link publicly.

## Accounts
The first time someone uses a username, they "sign up" with a password **and an invite code** right on the login screen — that reserves the name. After that, everyone logs in with just their username + password (no code needed to log in, only to sign up). Passwords are hashed, not stored in plain text, in `users.json`.

### Setting up who can kick people (and delete messages)
Open `server.js` and find this near the top:
```js
const ADMIN_CODE = 'changeme-admin';
```
Change it to your own secret code, and only give it out to people you trust with admin powers.

On the chat page, there's a small "🔒 Admin" button at the bottom of the sidebar. Click it, enter your code, and it unlocks:
- A ✕ button next to anyone online in the sidebar, to remove them from the chat (they can log back in right away — it's a kick, not a ban).
- A 🗑 button next to every message (hover to see it), to delete that message for everyone, including from the saved history.

This unlock applies to your current browser session — it's not tied to a specific username, so anyone you give the code to can unlock it from whatever account they're logged into.

### Setting your invite code
You're the only one who sets the invite code — friends can't pick their own, they just type in whatever code you give them when they sign up.

Open `server.js` and edit the very first line of actual code:
```js
const INVITE_CODE = 'letmein';
```
Change `'letmein'` to whatever code you want, e.g. `const INVITE_CODE = 'summer-bbq-2026';`, then save the file.

- **Running locally**: just restart `node server.js` after saving.
- **On Render**: push the change to your GitHub repo (Render redeploys automatically), or edit the file directly in GitHub's web editor and Render will pick it up.

**Change this before sharing your link with anyone** — the default `letmein` won't stop a stranger from signing up. Only share the code with people you actually want to have accounts.

## Notes & limitations
- Chat history and DMs are saved to disk (`history.json`, `dms.json`) so a normal server restart doesn't lose them. On Render's free tier, this data survives sleep/wake cycles but is wiped on a redeploy (pushing new code) — that's a limitation of the free tier without a paid persistent disk.
- Messages pass through a language filter that censors common profanity (including leetspeak like `f4ck` and spaced-out evasion like `f u c k`) before they're stored or sent. It errs toward not flagging normal words — if something slips through or gets over-censored, the word list is the `BAD_WORDS` array near the top of `server.js`.
- This is meant for a trusted group of friends, not the general public — there's no email verification or rate-limiting on login attempts.

## Troubleshooting
- **"Cannot find module 'ws'"** — run `npm install` in the project folder first.
- **Friends on Wi-Fi can't reach the Network address** — check your firewall, and make sure everyone's on the same network (not an isolated guest Wi-Fi).
- **Port already in use** — pick a different port with `PORT=3001 node server.js`.
- **Render build fails** — check the build logs in the Render dashboard; most often it's a missing `package.json` or wrong start command (should be `node server.js`).

