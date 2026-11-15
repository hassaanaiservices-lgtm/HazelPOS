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
| Mac | `~/Library/Application Support/HazelPOS` |
| Linux | `~/.config/HazelPOS` |

Inside: `pos.db` (everything), `whatsapp/auth` (the linked number), `whatsapp/media` (voice notes), `logs/server.log`.

## Try it from the source

```bash
npm --prefix client run build
npm --prefix desktop install
npm --prefix desktop start
```

## Build the installers

Easiest: push a tag and GitHub builds all three (`.github/workflows/desktop.yml`):

```bash
# bump "version" in desktop/package.json first
git tag v1.0.1 && git push --tags
```

The installers are attached to the GitHub release, and installed apps update themselves from there. If the repo is
private, auto-update can't read the releases: either make a separate public repo just for releases (change `publish`
in package.json), or host the files somewhere public.

On one machine: `npm --prefix desktop run dist:win` (or `dist:mac`, `dist:linux`). Build each OS on that OS.

## Activation and AI

The installed app runs with `HAZEL_LICENCE=1`. On first start it shows **Activate HazelPOS**: the restaurant types the
activation code from your admin app (`admin/`). Your cloud's address is built in: set it in
`package.json` → `"hazel": { "cloudUrl": "https://…" }` before building. The POS then downloads the restaurant's setup
(menu, pictures, tables, staff) and replaces the demo restaurant. There's no `.env` in the app, so the WhatsApp
assistant and voice notes go through your cloud (see `cloud/README.md`).

Open risks and decisions: [RISKS.md](../RISKS.md).
