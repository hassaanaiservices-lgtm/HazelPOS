# HazelPOS Printer

A small Windows tray app for the PC that has the shop's thermal printers. It does not run the POS. HazelPOS is online;
this app only fetches print jobs (receipts, kitchen tickets, test pages) from the server and sends them to the printers.
It makes outbound connections only, so the router needs no setup. The work is done by `bridge/bridge.js`
(`createBridge`), the same module the `bridge/index.js` command-line helper uses; printing uses `server/printer.js`.

## Setting up (the restaurant)
1. Install HazelPOS Printer. It opens a setup window and starts with Windows.
2. In HazelPOS: Settings, Printers, Set up printer helper. A 6-digit code appears (valid 10 minutes, usable once).
3. Type the code in the app. The server address is built in (Advanced changes it; Advanced also takes a pasted key instead).
4. Press Find printers (scans this PC's network for port 9100), pick the receipt and kitchen printers or type
   `192.168.1.50:9100`, `COM3` or `\\.\USB001`, press Save, then Print test page.

Closing the window keeps printing from the tray. Tray icon: green connected, amber printing, red cannot reach the server.
Tray menu: Open, Print test page, Start with Windows, Quit.

## Pairing
The app sends `POST /api/bridge/pair {code, name}` and receives `{device_key, restaurant:{slug,name}}`. The key is saved
and sent as `X-Device` on every call (`/api/bridge/ping|jobs|jobs/:id/done`). A wrong or expired code gives 400, too many tries 429.

## Config and logs
`%APPDATA%\HazelPOS Printer\config.json` (server, key, printers, autostart) and `printer.log`. Updates and reinstalls never touch them.
`HAZEL_PRINTER_DIR` overrides the folder, `HAZEL_SERVER_URL` the built-in server address (for testing).

## Run from source
```bash
npm --prefix desktop install
npm --prefix desktop start
```

## Releases and updates
Only a Windows installer is built, by GitHub Actions (`.github/workflows/desktop.yml`), and published to the public repo
`-HazelPOS-releases`, where installed apps check for updates every 6 hours and install on quit or via the tray's Restart to update.
One-time: make the empty public repo, a fine-grained token with Contents write on it only, and save it as the secret
`RELEASES_TOKEN` in the code repo. Set `hazel.serverUrl` in `desktop/package.json`. Every release: bump `version`, commit,
`git tag vX.Y.Z && git push --tags`. The tag must match the version.
