"""The table-QR story on the landing page: a customer waits for a waiter, scans the table's QR, orders from
the phone (seen through his eyes), the order pops up on the cashier's screen, the cashier accepts, the customer
is happy. Scroll plays it (site/qr-scene.js); this script writes the section's HTML into site/index.html
between the <!-- qr-scene:start --> and <!-- qr-scene:end --> markers.

    python3 tools/qr-scene/scene.py

Characters: Open Peeps by Pablo Stanley (CC0, see open-peeps/LICENSE), assembled by peep.py.
Rooms, hands, phone and POS screens are drawn here in the site's palette (site/styles.css, /DESIGN.md).
Every SVG is 1200 x 900 user units, shown with preserveAspectRatio="xMidYMid slice": on a phone only about the
middle 450 units (x 375-825) are visible, so the story stays in the centre; very wide screens lose the top and bottom."""
import pathlib, random, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from peep import base, part, OFF

ROOT = pathlib.Path(__file__).resolve().parents[2]
INDEX = ROOT / "site" / "index.html"

INK = "#1C1A17"
P = {"wall": "#F4E7CF", "wall2": "#EBD9B8", "floor": "#D3B98F", "floor2": "#C2A57A", "wood": "#B9824F",
     "wood2": "#9A6A3E", "top": "#D9A673", "top2": "#C99363", "card": "#FFFBF3", "sand": "#EADFC9",
     "accent": "#EF6C3C", "peach": "#F7D9C4", "mint": "#CDE9D8", "blue": "#D4DFEF", "board": "#2E3B34",
     "green": "#2F7A55", "amber": "#F2B44C", "glass": "#DCEBF2", "dark": "#3A2E26"}
S = f'stroke="{INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"'
S3 = f'stroke="{INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"'
FONT = 'font-family="Manrope, system-ui, sans-serif" font-weight="800"'

# ---------- characters ----------
CUSTOMER = {"skin": "#C68A60", "clothing": "#D9A23B", "headContrast": "#1C1A17"}
WAITER = {"skin": "#8D5A3B", "clothing": "#26221F", "headContrast": "#1C1A17"}
CASHIER = {"skin": "#C99068", "clothing": P["accent"], "headContrast": "#1C1A17"}
CUSTOMER_FACES = ["calm", "serious", "concerned", "tired", "solemn", "awe", "smile", "smileBig"]
CASHIER_FACES = ["calm", "awe", "smile", "smileBig"]


def peep(colors, head, faces, cls, extra=""):
    """A bust (704 units wide) with one <g> per face; data-face on an ancestor picks the one shown."""
    fs = "".join(f'<g class="qs-f qs-f--{f}" transform="{OFF["face"]}">{part("face", f, colors)}</g>' for f in faces)
    return (f'<g class="{cls}">{base(colors)}<g transform="{OFF["head"]}">{part("head", head, colors)}</g>'
            f'{fs}{extra}</g>')


def customer():
    # a shirt collar over the neckline, so he reads as out for dinner rather than in a T-shirt
    collar = (f'<path d="M296 636 L352 694 L326 728 L284 664 Z" fill="{P["card"]}" {S}/>'
              f'<path d="M408 636 L352 694 L378 728 L420 664 Z" fill="{P["card"]}" {S}/>'
              f'<circle cx="352" cy="760" r="7" fill="{INK}"/><circle cx="352" cy="820" r="7" fill="{INK}"/>')
    glasses = f'<g transform="{OFF["accessories"]}">{part("accessories", "glasses2", CUSTOMER)}</g>'
    return peep(CUSTOMER, "short5", CUSTOMER_FACES, "qs-cust__peep", collar + glasses)


def waiter():
    # black shirt, bow tie and a white apron bib: reads as staff even small and far away
    extra = (f'<path d="M300 700 h104 l22 330 h-148 z" fill="{P["card"]}" {S}/>'
             f'<path d="M322 640 l30 16 l30 -16 v36 l-30 -16 l-30 16 z" fill="{P["accent"]}" {S}/>')
    return peep(WAITER, "short1", ["explaining"], "qs-waiter__peep", extra)


def cashier():
    return peep(CASHIER, "hijab", CASHIER_FACES, "qs-cashier__peep")


def qr_pattern(x, y, size, seed=7, fg=INK):
    """A QR-looking 21 x 21 grid with the three finder squares. Decoration only, it encodes nothing."""
    rnd, n = random.Random(seed), 21
    c = size / n
    out = [f'<rect x="{x}" y="{y}" width="{size}" height="{size}" fill="#fff"/>']
    finder = lambda fx, fy: (f'<rect x="{x+fx*c+c/2}" y="{y+fy*c+c/2}" width="{6*c}" height="{6*c}" fill="none" stroke="{fg}" stroke-width="{c}"/>'
                             f'<rect x="{x+(fx+2)*c}" y="{y+(fy+2)*c}" width="{3*c}" height="{3*c}" fill="{fg}"/>')
    out += [finder(0, 0), finder(14, 0), finder(0, 14)]
    for i in range(n):
        for j in range(n):
            if (i < 8 and j < 8) or (i > 12 and j < 8) or (i < 8 and j > 12):
                continue
            if rnd.random() < 0.48:
                out.append(f'<rect x="{x+i*c:.2f}" y="{y+j*c:.2f}" width="{c+.3:.2f}" height="{c+.3:.2f}" fill="{fg}"/>')
    return "".join(out)


# ---------- shot 1: the dining room ----------
def room():
    p, w = P, []
    w.append(f'<rect width="1200" height="900" fill="{p["wall"]}"/>')
    w.append(f'<rect y="0" width="1200" height="40" fill="{p["wall2"]}"/><line x1="0" y1="40" x2="1200" y2="40" {S3}/>')
    # framed picture (left) and wall clock (right): wide screens only
    w.append(f'<g><rect x="96" y="120" width="170" height="130" fill="{p["card"]}" {S}/>'
             f'<rect x="112" y="136" width="138" height="98" fill="{p["peach"]}" {S3}/>'
             f'<path d="M134 200 q47 44 94 0 z" fill="{p["accent"]}" {S3}/><path d="M150 186 q10 -16 0 -28 M180 184 q10 -16 0 -28 M210 186 q10 -16 0 -28" fill="none" {S3}/></g>')
    w.append(f'<g class="qs-clock"><circle cx="1060" cy="210" r="56" fill="{p["card"]}" {S}/>'
             + "".join(f'<line x1="1060" y1="{160 if i % 3 == 0 else 164}" x2="1060" y2="170" {S3} transform="rotate({i*30} 1060 210)"/>' for i in range(12))
             + f'<line class="qs-clock__h" x1="1060" y1="210" x2="1060" y2="180" {S}/>'
             f'<line class="qs-clock__m" x1="1060" y1="210" x2="1060" y2="166" stroke="{p["accent"]}" stroke-width="4.5" stroke-linecap="round"/>'
             f'<circle cx="1060" cy="210" r="6" fill="{INK}"/></g>')
    # the menu board over the counter
    items = "".join(f'<rect x="470" y="{196+i*20}" width="{[120,96,140,110][i]}" height="7" rx="3.5" fill="{p["sand"]}" opacity=".85"/>'
                    f'<rect x="{676}" y="{196+i*20}" width="54" height="7" rx="3.5" fill="{p["amber"]}"/>' for i in range(4))
    w.append(f'<g><rect x="440" y="110" width="320" height="196" rx="10" fill="{p["board"]}" {S}/>'
             f'<text x="600" y="168" text-anchor="middle" font-size="38" fill="{p["card"]}" {FONT} letter-spacing="2">MENU</text>{items}</g>')
    # pendant lamps
    for x in (300, 900):
        w.append(f'<g><line x1="{x}" y1="40" x2="{x}" y2="96" {S3}/><circle cx="{x}" cy="132" r="26" fill="#FFE7A8" opacity=".55"/>'
                 f'<path d="M{x-34} 128 L{x-16} 96 h32 L{x+34} 128 Z" fill="{p["accent"]}" {S}/></g>')
    # kitchen pass on the right, with steam
    w.append(f'<g><rect x="830" y="300" width="330" height="196" fill="{p["dark"]}" {S}/>'
             f'<rect x="846" y="316" width="298" height="164" fill="#5A4636"/>'
             f'<path d="M870 470 h90 v-30 h-90 z M990 470 h120 v-50 h-120 z" fill="#7A604A"/>'
             f'<g class="qs-steam" fill="none" stroke="{p["card"]}" stroke-width="5" stroke-linecap="round" opacity=".8">'
             f'<path d="M900 430 q-14 -20 0 -40 q14 -20 0 -40"/><path d="M1040 410 q-14 -20 0 -40 q14 -20 0 -40"/></g>'
             f'<rect x="900" y="262" width="190" height="40" rx="8" fill="{p["card"]}" {S3}/>'
             f'<text x="995" y="290" text-anchor="middle" font-size="22" fill="{INK}" {FONT}>KITCHEN</text></g>')
    # cashier far left, behind the counter (wide screens), with her screen
    w.append(f'<g transform="translate(40 296) scale(.3)">{cashier()}</g>')
    w.append(f'<g><path d="M250 498 l8 -60 h74 l8 60 z" fill="{INK}"/><rect x="262" y="446" width="66" height="44" rx="4" fill="{p["peach"]}"/></g>')
    # the waiter, busy at the kitchen pass: moved by the script
    w.append(f'<g class="qs-waiter" transform="translate(760 0)"><g transform="translate(0 276) scale(.32)">{waiter()}'
             f'<circle class="qs-waiter__anchor" cx="352" cy="40" r="1" fill="none"/></g></g>')
    # the long counter in front of them, then the floor
    w.append(f'<rect x="-10" y="492" width="1220" height="22" fill="{p["top"]}" {S}/>'
             f'<rect x="-10" y="514" width="1220" height="100" fill="{p["wood"]}" {S}/>'
             + "".join(f'<rect x="{x}" y="528" width="96" height="72" rx="6" fill="none" stroke="{p["wood2"]}" stroke-width="4"/>' for x in range(14, 1200, 120)))
    w.append(f'<rect x="-10" y="614" width="1220" height="300" fill="{p["floor"]}"/><line x1="-10" y1="614" x2="1210" y2="614" {S3}/>')
    # his chair, empty until he sits
    w.append(f'<g><rect x="478" y="400" width="22" height="270" rx="8" fill="{p["wood2"]}" {S}/>'
             f'<rect x="700" y="400" width="22" height="270" rx="8" fill="{p["wood2"]}" {S}/>'
             f'<rect x="466" y="384" width="268" height="52" rx="22" fill="{p["wood"]}" {S}/>'
             f'<rect x="500" y="470" width="200" height="22" rx="8" fill="{p["wood"]}" {S3}/></g>')
    # the customer: walked in and seated by the script
    w.append(f'<g class="qs-cust" transform="translate(1300 140)"><g class="qs-cust__bob"><g transform="scale(.5)">{customer()}</g>'
             f'<g class="qs-sweat"><path d="M300 150 q14 24 0 34 q-14 -10 0 -34z" fill="#9CC3D4" {S3}/></g></g></g>')
    # his table: runs the full width so it hides everything below his chest
    w.append(f'<rect x="-10" y="656" width="1220" height="70" fill="{p["top"]}" {S}/>'
             f'<rect x="-10" y="726" width="1220" height="24" fill="{p["top2"]}" {S}/>'
             f'<rect x="-10" y="750" width="1220" height="170" fill="{p["wood"]}" {S}/>'
             + "".join(f'<line x1="{x}" y1="750" x2="{x}" y2="910" stroke="{p["wood2"]}" stroke-width="4"/>' for x in range(60, 1200, 150)))
    # on the table: water glass, his phone, and the QR stand
    w.append(f'<g><path d="M372 598 h56 l-6 72 h-44 z" fill="{p["glass"]}" {S}/><path d="M378 622 h44" stroke="#9CC3D4" stroke-width="4"/></g>')
    w.append(f'<rect x="520" y="676" width="88" height="16" rx="6" fill="{INK}"/><rect x="530" y="679" width="68" height="6" rx="3" fill="#4A4540"/>')
    w.append(f'<g class="qs-tent"><ellipse class="qs-tent__glow" cx="752" cy="612" rx="96" ry="88" fill="{p["amber"]}" opacity="0"/>'
             f'<path d="M700 548 h104 l14 122 h-132 z" fill="{p["card"]}" {S}/>'
             f'<path d="M703 548 h98 l3 26 h-104 z" fill="{p["accent"]}" {S3}/>'
             f'<text x="752" y="568" text-anchor="middle" font-size="11.5" fill="{INK}" {FONT}>SCAN TO ORDER</text>'
             f'{qr_pattern(722, 584, 60)}<rect x="722" y="584" width="60" height="60" fill="none" {S3}/>'
             f'<text x="752" y="664" text-anchor="middle" font-size="16" fill="{INK}" {FONT}>T4</text>'
             f'<circle class="qs-tent__anchor" cx="752" cy="614" r="1" fill="none"/></g>')
    w.append(f'<circle class="qs-think" cx="760" cy="292" r="1" fill="none"/>')
    return (f'<svg class="qs-svg" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" '
            f'xmlns="http://www.w3.org/2000/svg">{"".join(w)}</svg>')


# ---------- shot 3: the counter ----------
def counter():
    p, w = P, []
    w.append(f'<rect width="1200" height="900" fill="{p["wall"]}"/>')
    # sign, shelves, plant
    w.append(f'<g><rect x="420" y="80" width="360" height="86" rx="14" fill="{p["accent"]}" {S}/>'
             f'<text x="600" y="136" text-anchor="middle" font-size="34" fill="{INK}" {FONT}>Your Restaurant</text></g>')
    for y, xs in ((250, (110, 960)),):
        for x0 in xs:
            w.append(f'<rect x="{x0}" y="{y}" width="200" height="16" fill="{p["wood"]}" {S}/>'
                     + "".join(f'<rect x="{x0+16+i*46}" y="{y-56+(i%2)*10}" width="34" height="{56-(i%2)*10}" rx="6" fill="{[p["amber"], p["mint"], p["peach"], p["blue"]][i]}" {S3}/>' for i in range(4)))
    w.append(f'<g><path d="M150 560 h90 l-12 80 h-66 z" fill="{p["accent"]}" {S}/>'
             f'<path d="M195 560 q-50 -60 -30 -130 q40 40 30 130z M195 560 q40 -80 70 -110 q10 60 -70 110z M195 560 q-10 -90 10 -150 q30 70 -10 150z" fill="{p["green"]}" {S3}/></g>')
    # the cashier, centred so phones see her
    w.append(f'<g class="qs-cashier" transform="translate(424 214) scale(.5)">{cashier()}</g>')
    # counter
    w.append(f'<rect x="-10" y="640" width="1220" height="30" fill="{p["top"]}" {S}/>'
             f'<rect x="-10" y="670" width="1220" height="250" fill="{p["wood"]}" {S}/>'
             + "".join(f'<rect x="{x}" y="690" width="120" height="190" rx="8" fill="none" stroke="{p["wood2"]}" stroke-width="4"/>' for x in range(20, 1200, 150)))
    w.append(f'<circle class="qs-chin" cx="600" cy="482" r="1" fill="none"/>')
    return (f'<svg class="qs-svg" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" '
            f'xmlns="http://www.w3.org/2000/svg">{"".join(w)}</svg>')


# ---------- shot 2: through his eyes ----------
def table_top():
    """The table seen from above, behind the phone."""
    p, w = P, []
    w.append(f'<rect width="1200" height="900" fill="{p["top"]}"/>')
    for i, y in enumerate(range(-40, 900, 120)):
        w.append(f'<line x1="-10" y1="{y}" x2="1210" y2="{y+60}" stroke="{p["top2"]}" stroke-width="5"/>')
    w.append(f'<g opacity=".95"><circle cx="1010" cy="170" r="70" fill="{p["glass"]}" {S}/><circle cx="1010" cy="170" r="50" fill="none" stroke="#9CC3D4" stroke-width="4"/></g>')
    w.append(f'<g><ellipse cx="190" cy="230" rx="150" ry="120" fill="{p["card"]}" {S}/><ellipse cx="190" cy="230" rx="100" ry="78" fill="none" stroke="{p["sand"]}" stroke-width="4"/></g>')
    w.append(f'<g transform="translate(560 40)"><path d="M0 0 h120 l12 110 h-144 z" fill="{p["card"]}" {S}/>'
             f'<path d="M3 0 h114 l3 24 h-120 z" fill="{p["accent"]}" {S3}/>{qr_pattern(30, 34, 60)}</g>')
    return (f'<svg class="qs-svg" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" '
            f'xmlns="http://www.w3.org/2000/svg">{"".join(w)}</svg>')


def lighter(hexcol, k=0.28):
    """A paler tone of a colour, for fingernails."""
    r, g, b = (int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
    return "#%02X%02X%02X" % tuple(round(c + (255 - c) * k) for c in (r, g, b))


def hand_back(skin, sleeve):
    """Left hand under the phone (rig units: 640 x 860, phone at x 160-480, y 60-720), as in a photo of someone
    holding a phone up: fingertips peeking past the right edge, the palm at the bottom-left corner, the forearm
    running down-left with the sleeve cuff. The fingers' bases and most of the palm are hidden by the phone."""
    crease = f'fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".4"'
    tips = "".join(f'<rect x="400" y="{y}" width="{80+l}" height="{h}" rx="{h/2}" fill="{skin}" {S}/>'
                   for y, l, h in ((372, 58, 40), (418, 64, 42), (466, 58, 40), (512, 42, 34)))
    return (f'<svg class="qs-hand qs-hand--back" viewBox="0 0 640 860" xmlns="http://www.w3.org/2000/svg">'
            f'<g transform="rotate(45 200 780)"><rect x="110" y="700" width="180" height="420" rx="40" fill="{skin}" {S}/>'
            f'<rect x="96" y="870" width="208" height="70" rx="8" fill="{sleeve}" {S}/></g>'
            f'<path d="M118 560 C92 630 90 730 124 782 C170 808 250 800 292 756 C300 740 304 720 306 700 L306 540 Z" fill="{skin}" {S}/>'
            f'<path d="M150 760 C190 782 240 782 280 766" {crease}/>{tips}</svg>')


def hand_front(skin):
    """Over the phone: the thumb up its left edge, the nail showing, the tip resting on the bezel."""
    crease = f'fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".4"'
    return (f'<svg class="qs-hand qs-hand--front" viewBox="0 0 640 860" xmlns="http://www.w3.org/2000/svg">'
            f'<g transform="rotate(-4 147 620)"><rect x="118" y="476" width="58" height="270" rx="29" fill="{skin}" {S}/>'
            f'<ellipse cx="160" cy="506" rx="11" ry="16" fill="{lighter(skin)}" stroke="{INK}" stroke-width="2.5"/>'
            f'<path d="M128 612 q19 -8 38 0" {crease}/></g></svg>')


def pointer(skin, sleeve, cls):
    """A right hand seen from the back, index finger out, the other fingers folded, thumb tucked on the left.
    Its fingertip is at (0, 0) of the drawing = (120, 20) px of the element; the script moves and tilts it."""
    nail = lighter(skin)
    return (f'<svg class="qs-finger {cls}" viewBox="-120 -20 520 680" width="520" height="680" xmlns="http://www.w3.org/2000/svg">'
            f'<g class="qs-finger__hand">'
            f'<path d="M28 296 L150 276 L360 700 L110 760 Z" fill="{sleeve}" {S}/>'
            f'<path d="M28 296 L150 276 L162 304 L40 326 Z" fill="{sleeve}" {S}/>'
            # the index finger, then the back of the hand over its base
            f'<path d="M-20 190 L-19 30 C-19 6 -10 -3 0 -3 C10 -3 19 6 19 30 L22 190 Z" fill="{skin}" {S}/>'
            f'<rect x="-10" y="5" width="20" height="25" rx="9" fill="{nail}" stroke="{INK}" stroke-width="2.5"/>'
            f'<path d="M-11 74 q11 6 22 0 M-12 118 q12 6 24 0" fill="none" {S3}/>'
            f'<path d="M-26 150 C-38 214 -22 284 30 304 L150 286 C172 236 170 178 142 146 C110 128 20 128 -26 150 Z" fill="{skin}" {S}/>'
            # folded fingers: their knuckles along the top edge
            f'<rect x="20" y="124" width="40" height="62" rx="20" fill="{skin}" {S}/>'
            f'<rect x="58" y="132" width="38" height="58" rx="19" fill="{skin}" {S}/>'
            f'<rect x="94" y="142" width="36" height="52" rx="18" fill="{skin}" {S}/>'
            f'<path d="M52 214 L60 266 M92 214 L96 262" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round" opacity=".35"/>'
            # thumb tucked on the left
            f'<path d="M-24 236 C-62 222 -78 182 -66 158 C-56 140 -34 144 -28 164 C-22 186 -12 204 2 214 Z" fill="{skin}" {S}/>'
            f'</g></svg>')


# ---------- the phone screens (the real QR page, client/src/CustomerOrder.jsx, light theme) ----------
MENU = [  # [id, emoji, name, price text, button]; the demo restaurant's menu (demo/seed.js)
    ("karahi", "🍲", "Chicken Karahi", "from Rs. 1,400", "Choose"),
    ("", "🍲", "Mutton Karahi", "from Rs. 2,400", "Choose"),
    ("", "🍗", "Chicken Tikka", "from Rs. 450", "Choose"),
    ("", "🍢", "Seekh Kabab", "Rs. 900", "Add"),
    ("", "🍛", "Chicken Biryani", "from Rs. 450", "Choose"),
    ("", "🍔", "Zinger Burger", "from Rs. 650", "Choose"),
    ("naan", "🫓", "Garlic Naan", "Rs. 120", "Add"),
    ("", "🫓", "Roghni Naan", "Rs. 80", "Add"),
    ("raita", "🥣", "Raita", "Rs. 100", "Add"),
    ("", "🥤", "Soft Drink", "from Rs. 150", "Choose"),
]


def phone():
    items = []
    for key, emoji, name, price, btn in MENU:
        k = f' data-item="{key}"' if key else ""
        control = (f'<span class="qs-add" data-t="{key}-add">{btn}</span>'
                   + (f'<span class="qs-qty"><span data-t="{key}-minus">−</span><b>1</b><span data-t="{key}-plus">+</span></span>' if key in ("naan", "raita") else ""))
        items.append(f'<div class="qs-item"{k}><span class="qs-emoji">{emoji}</span><span class="qs-info"><b>{name}</b><span>{price}</span></span>{control}</div>')
    cats = "".join(f'<span{" class=on" if c == "All" else ""}>{c}</span>' for c in ["All", "BBQ &amp; Karahi", "Biryani &amp; Rice", "Burgers"])
    option_sheet = ('<div class="qs-sheet qs-sheet--opt"><div class="qs-sheet-head"><b>🍲 Chicken Karahi</b><span>✕</span></div>'
                    '<p class="qs-muted">Fresh chicken cooked in a wok with tomatoes, green chillies and ginger.</p>'
                    '<h4>Size</h4><div class="qs-chips"><span data-t="half">Half · Rs. 1,400</span><span>Full · Rs. 2,600</span></div>'
                    '<h4>Spice level <small>optional</small></h4><div class="qs-chips"><span>Mild</span><span data-t="medium">Medium</span><span>Hot</span></div>'
                    '<span class="qs-primary" data-t="opt-add"><span class="qs-off">Choose a size</span><span class="qs-on">Add · Rs. 1,400</span></span></div>')
    order_sheet = ('<div class="qs-sheet qs-sheet--order"><div class="qs-sheet-head"><b>Your order · T4</b><span>✕</span></div>'
                   '<div class="qs-line"><span>🍲</span><span class="qs-info"><b>Chicken Karahi (Half)</b><small>+ Medium</small></span><span class="qs-n">1</span></div>'
                   '<div class="qs-line"><span>🫓</span><span class="qs-info"><b>Garlic Naan</b></span><span class="qs-n">2</span></div>'
                   '<div class="qs-line"><span>🥣</span><span class="qs-info"><b>Raita</b></span><span class="qs-n">1</span></div>'
                   '<div class="qs-totals"><div><span>Subtotal</span><span>Rs. 1,740</span></div><div><span>Tax (16%)</span><span>Rs. 278</span></div>'
                   '<div class="qs-grand"><span>Total</span><span>Rs. 2,018</span></div></div>'
                   '<span class="qs-primary" data-t="place">Place order</span><p class="qs-muted qs-c">Pay at the counter or to your waiter.</p></div>')
    cam = ('<div class="qs-cam"><div class="qs-cam-view"><span class="qs-cam-qr">'
           f'<svg viewBox="0 0 120 120">{qr_pattern(0, 0, 120)}</svg></span><span class="qs-cam-frame"></span><span class="qs-cam-line"></span></div>'
           '<p>Point the camera at the QR on your table</p><span class="qs-cam-link">🔗 Your Restaurant · Table T4</span></div>')
    sent = ('<div class="qs-done qs-done--sent"><div class="qs-big">⏳</div><b>Order sent!</b><p>Waiting for staff to confirm your order…</p>'
            '<p class="qs-muted">T4 · Order #128</p></div>'
            '<div class="qs-done qs-done--ok"><div class="qs-big">✅</div><b>Order confirmed!</b><p>The kitchen is preparing your food.</p>'
            '<p class="qs-muted">T4 · Order #128</p></div>')
    return (f'<div class="qs-phone" data-screen="cam"><div class="qs-screen">'
            f'<div class="qs-status"><span>7:52</span><span class="qs-notch"></span><span>5G ▮▮▮</span></div>'
            f'{cam}<div class="qs-menu"><div class="qs-head"><b>🍽️ Your Restaurant</b><span>🍽️ T4<small>Main Dining</small></span></div>'
            f'<div class="qs-cats">{cats}</div><div class="qs-list-wrap"><div class="qs-list">{"".join(items)}</div></div>'
            f'<span class="qs-cartbar" data-t="cart"><span class="qs-badge">1</span> View order <b>Rs. 1,400</b></span>'
            f'<span class="qs-dim"></span>{option_sheet}{order_sheet}</div>{sent}</div></div>')


def monitor():
    """The cashier's POS (light theme) with the QR order pop-up (client/src/QrOrders.jsx)."""
    tables = "".join(f'<span class="qs-tbl{" busy" if t in ("T1", "T3") else ""}"><b>{t}</b><small>{"Rs. 4,130" if t == "T1" else "Rs. 2,890" if t == "T3" else "Free"}</small></span>'
                     for t in ("T1", "T2", "T3", "T4", "T5", "T6"))
    nav = "".join(f'<span{" class=on" if n == "Tables" else ""}>{n}</span>' for n in ("Home", "Tables", "Orders", "Kitchen", "Delivery", "QR codes", "WhatsApp"))
    modal = ('<div class="qs-modal"><div class="qs-modal-head"><span class="qs-bell">🔔</span><span><b>New QR order, T4</b><small>Main Dining · 7:53 PM</small></span></div>'
             '<div class="qs-mline"><b>1 ×</b><span>Chicken Karahi (Half)<small>+ Medium</small></span><span>Rs. 1,400</span></div>'
             '<div class="qs-mline"><b>2 ×</b><span>Garlic Naan</span><span>Rs. 240</span></div>'
             '<div class="qs-mline"><b>1 ×</b><span>Raita</span><span>Rs. 100</span></div>'
             '<div class="qs-mtotal"><span>Subtotal</span><b>Rs. 1,740</b></div>'
             '<div class="qs-mact"><span class="qs-reject">Reject</span><span class="qs-accept" data-t="accept">Accept &amp; send to kitchen</span></div></div>')
    return (f'<div class="qs-monitor"><div class="qs-mscreen"><div class="qs-pos"><div class="qs-side"><b>Your Restaurant</b>{nav}</div>'
            f'<div class="qs-main"><b class="qs-h">Main Dining</b><div class="qs-tbls">{tables}</div></div></div>'
            f'<div class="qs-scrim"></div>{modal}<div class="qs-toast">✓ T4 order sent to kitchen</div></div>'
            f'<div class="qs-stand"></div></div>')


CAPTIONS = [
    "A customer sits down at table T4.",
    "No menu. The waiter is busy. The wait begins.",
    "On the table: a QR code.",
    "He scans it and orders from his phone.",
    "The order pops up at the counter. One tap to accept.",
    "Confirmed in seconds. Nobody waited for a waiter.",
]


def section():
    caps = "".join(f'<span data-cap="{i}"><i>{i+1:02d}</i>{c}</span>' for i, c in enumerate(CAPTIONS))
    bubbles = ("".join(f'<span class="qs-bubble" data-b="{i}">{t}</span>' for i, t in enumerate(
        ["Menu kahan hai?", "Excuse me… bhai!", "10 minute ho gaye…", "Order kab hoga?!", "Oh, a QR code!"]))
        + '<span class="qs-say">Ji, abhi aaya!</span>')
    return f'''<!-- qr-scene:start (generated by tools/qr-scene/scene.py: edit the generator, not this block) -->
    <!-- The table-QR story: scroll plays it (qr-scene.js). Characters: Open Peeps by Pablo Stanley, CC0. -->
    <section class="section qr" id="qr-order">
      <div class="container">
        <div class="head-split">
          <h2>Customers order from the table</h2>
          <p class="lead">They scan the QR on the table, order from their phone, and it pops up on your counter. Scroll to watch it.</p>
        </div>
      </div>
      <div class="qs" data-qs>
        <div class="qs-track">
          <div class="qs-stage">
            <div class="qs-visual" aria-hidden="true">
              <div class="qs-shot qs-room">{room()}<div class="qs-bubbles">{bubbles}</div>
                <div class="qs-pop"><span class="qs-pop-ico">✅</span><span><b>Order confirmed!</b>The kitchen is preparing your food.</span></div></div>
              <div class="qs-shot qs-pov">{table_top()}<div class="qs-rig">{hand_back(CUSTOMER["skin"], CUSTOMER["clothing"])}{phone()}{hand_front(CUSTOMER["skin"])}<span class="qs-tap"></span>{pointer(CUSTOMER["skin"], CUSTOMER["clothing"], "qs-finger--cust")}</div></div>
              <div class="qs-shot qs-counter">{counter()}<div class="qs-mrig">{monitor()}<span class="qs-tap"></span>{pointer(CASHIER["skin"], CASHIER["clothing"], "qs-finger--cash")}</div></div>
              <p class="qs-cap">{caps}</p>
              <span class="qs-hint">Scroll ↓</span>
            </div>
            <div class="qs-end">
              <b>No waiting for a waiter</b>
              <p>Every table gets its own QR. Orders land on your counter, you tap Accept, the kitchen gets the ticket.</p>
              <a class="btn btn-primary" href="#start" data-demo-link>Start free demo</a>
            </div>
          </div>
        </div>
        <div class="sr-only">
          <h3>How table QR ordering works</h3>
          <p>A customer sits down and no waiter comes to take the order. He scans the QR code on his table, picks a chicken karahi,
          two garlic naan and a raita on his phone and places the order. It pops up on the cashier's screen as a new QR order for
          table T4. The cashier taps Accept and send to kitchen, and the customer's phone shows Order confirmed.</p>
        </div>
      </div>
    </section>
    <!-- qr-scene:end -->'''


def main():
    html = INDEX.read_text()
    block = section()
    if "<!-- qr-scene:start" in html:
        html = re.sub(r"<!-- qr-scene:start.*?<!-- qr-scene:end -->", lambda m: block, html, flags=re.S)
    else:  # first run: after the WhatsApp section
        anchor = "    <!-- Switcher: one screen per job -->"
        assert anchor in html
        html = html.replace(anchor, "    " + block + "\n\n" + anchor)
    INDEX.write_text(html)
    print(f"wrote {INDEX.relative_to(ROOT)} ({len(block)//1024} KB section)")


if __name__ == "__main__":
    main()
