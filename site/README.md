# HazelPOS landing page

A static page (`index.html`, `styles.css`, `images/`), no build step. Host it on any static host
(Cloudflare Pages, Vercel, Netlify) by pointing it at this folder.

Preview locally:

```bash
python3 -m http.server 4600 --directory site
```

then open http://localhost:4600.

## Before it goes live

1. **Demo link.** In `index.html`, set `DEMO_URL` (near the bottom) to the demo's address once the demo server is
   live. Until then every "Start free demo" button leads to the closing section.
2. **Sales WhatsApp number.** Replace the dashed placeholder `your sales number` in the closing section.
3. **Pricing.** The page says "Message us" on purpose; change the last question if you publish prices.

## Screenshots

`images/` are real screens of the demo restaurant (`demo/template.db`, built by `node demo/seed.js`), captured at 2x in the POS cream (light) theme. Each sits in a dark ink bezel so it stands apart from the cream bands.
Recapture in the light theme too.
All names, phone numbers and amounts in them are samples. Recapture them after design changes so the page shows the
product as it is.

## Design

Same system as the POS (`/DESIGN.md`), in its light "dark cream" theme: sand ground, near-white cards, near-black ink,
ember orange, Manrope, and the POS's chunky outlined style (2px ink outlines, solid offset shadows, pill buttons). Each
section sits on its own soft band (peach hero, mint WhatsApp, blue reports, sand tour and questions, orange close). Built with the Hallmark skill
(stamp at the top of `styles.css`).
