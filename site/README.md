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
2. **Sales WhatsApp number.** Done: +92 319 4188820, linked as `wa.me/923194188820` in the hero, the closing band, the FAQ, the footer, the floating button and the structured data. To change it, search the page for `923194188820`.
3. **Pricing.** The page says "Message us" on purpose; change the last question if you publish prices.

## Screenshots

`images/` are real screens of the demo restaurant (`demo/template.db`, built by `node demo/seed.js`), captured at 2x in the POS cream (light) theme. Each sits in a dark ink bezel so it stands apart from the cream bands.
Recapture in the light theme too.
All names, phone numbers and amounts in them are samples. Recapture them after design changes so the page shows the
product as it is.

The page uses WebP files (about 60% lighter than PNG, which matters for search ranking). After recapturing, convert each PNG
to WebP at quality 82 and remove the PNG. `images/share.jpg` (1200x630) is the picture shown when the link is shared.

## Search and AI assistants

`robots.txt`, `sitemap.xml`, `llms.txt` and the tags and JSON-LD in the `<head>` of `index.html` all carry the live address.
When the domain changes, change it in all four. The FAQ in the JSON-LD must stay word for word the same as the FAQ on the page.

## Design

Same system as the POS (`/DESIGN.md`), in its light "dark cream" theme: sand ground, near-white cards, near-black ink,
ember orange, Manrope, and the POS's chunky outlined style (2px ink outlines, solid offset shadows, pill buttons). Each
section sits on its own soft band (peach hero, mint WhatsApp, blue reports, sand tour and questions, orange close). Built with the Hallmark skill
(stamp at the top of `styles.css`).
