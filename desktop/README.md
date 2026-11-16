# HazelPOS desktop app

The installer the restaurant downloads. It runs the POS server on that PC (billing works with no internet) and opens
the POS in its own window, with a desktop icon. Closing the window keeps it running in the tray, so the kitchen screen,
tablets and WhatsApp keep working. The tray menu has **Connect other screens** (a QR code with the PC's address),
**Start with this computer** (on by default), **Open data folder** and **Quit**.

## Where the data lives

Not in the install folder, so updates and reinstalls never touch it:

| OS | Folder |
| --- | --- |
| Windows | `%APPDATA%\HazelPOS` |

Inside: `pos.db` (everything), `whatsapp/auth` (the linked number), `whatsapp/media` (voice notes), `logs/server.log`.

## Try it from the source

```bash
npm --prefix client run build
npm --prefix desktop install
npm --prefix desktop start
```

## Build the installer (Windows only)

Restaurants run Windows, so only a Windows installer is built. It is built **on GitHub's Windows machine**, never on
your laptop: a Windows installer made on Linux or Mac carries the wrong image library (sharp), and then the WhatsApp
menu pictures don't send. (`npm run dist:win` refuses to run off Windows; a throw-away test build needs `ALLOW_CROSS_BUILD=1`.)

### One-time setup (about 10 minutes)

The code repo can stay private. Installed apps look for updates in a **public** repo that holds only the installers:

1. On GitHub, create an empty **public** repo named `HazelPOS-releases` (same account as the code repo).
2. Make a token: GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: **only**
   `HazelPOS-releases`. Permission: **Contents: Read and write**. Copy it.
3. In the **code** repo: Settings → Secrets and variables → Actions → New repository secret. Name `RELEASES_TOKEN`, value: the token.
4. Fill in `desktop/package.json` → `hazel`: `cloudUrl` (your cloud's address) and `licencePublicKey`
   (open `https://<your-cloud>/api/licence/public-key` and paste what it shows). The build refuses to run without both.
5. If your GitHub account isn't `hassaanaiservices-lgtm`, change `owner` under `build.publish` in `desktop/package.json`.

### Every release

```bash
# 1. bump "version" in desktop/package.json and commit
# 2. tag it (the tag must be v + the same version) and push
git tag v1.0.1 && git push --tags
```

GitHub (Actions → "Windows installer") builds it, checks it (cloud address and licence key present, sharp works,
installer size sane, update files present), and publishes `HazelPOS-Setup-<version>.exe` to the releases repo. That
page is also the download link for new clients, and installed apps update themselves from it (to a few test clients
first, then everyone: admin app → Updates). Uninstalling HazelPOS never deletes a restaurant's data.

### Size

About 94 MB (Electron itself is most of it). Updates download only what changed (the `.blockmap` file next to the installer).

## Activation and AI

The installed app runs with `HAZEL_LICENCE=1`. On first start it shows **Activate HazelPOS**: the restaurant types the
activation code from your admin app (`admin/`). Your cloud's address is built in: set it in
`package.json` → `"hazel": { "cloudUrl": "https://…" }` before building. The POS then downloads the restaurant's setup
(menu, pictures, tables, staff) and replaces the demo restaurant. There's no `.env` in the app, so the WhatsApp
assistant and voice notes go through your cloud (see `cloud/README.md`).

Open risks and decisions: [RISKS.md](../RISKS.md).

## Port

The POS uses port 4000. If another program already uses it, HazelPOS takes the next free port (4001…), remembers it in
`port.txt` in the data folder, and tells the owner once. The tray's **Connect other screens** always shows the real address.

## First login on a real install

A fresh install has no PIN of its own. The owner logs in with `1234`, and the POS asks them to choose their own PIN
before anything else works. The cashier, kitchen and riders can't log in until the owner gives them PINs
(Settings → Staff & PINs). The demo restaurant's data is cleared when the install is activated.
