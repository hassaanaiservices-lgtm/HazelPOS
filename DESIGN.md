# HazelPOS design system

Mode: **Operate.** Staff use HazelPOS to finish a task fast, often standing, on a touchscreen, under restaurant lighting,
for a whole shift. Clarity, consistency and big hit targets beat decoration. The tool should disappear into the task.

Source of truth for every value below: the `:root` block at the top of `client/src/App.css`. No colour or font is written
anywhere else; components use the tokens.

## World

A counter at night: warm charcoal surfaces, one ember-orange accent, quiet everywhere else.

- **Palette.** Warm neutrals in four steps (`--bg`, `--surface`, `--surface-2`, `--surface-3`) plus hairlines
  (`--line`, `--line-strong`). Text in three steps (`--text`, `--text-2`, `--text-3`).
- **Accent** `--accent` (ember orange) marks the primary action, the current selection and the active nav item. Nothing
  decorative is orange.
- **State colours** carry meaning only: `--ok` (paid, free table, cash in), `--warn` (waiting, cooking, running late),
  `--danger` (delete, short, overdue, cash out), `--info` (new kitchen ticket). Soft fills (`--ok-soft` etc.) sit behind
  status pills.
- **Category colours** come from the menu data (`--c` set inline) and appear only as the category chip and the thin top
  edge of a product tile.
- **Paper** (`--paper`, `--ink`) is reserved for things that print: receipts, the A4 tax invoice, the Z-report and QR cards.

## Themes

Dark is the default; Light is for daytime counters and bright shops; Auto follows the device. Each screen picks its own
(switch at the bottom of the sidebar, or the sun/moon button in the kitchen's top bar) and remembers it in that browser.

- Light ("dark cream"): a warm sand ground `--bg` `#eadfc9`; cards stay warm near-white `--surface` `#fffbf3` so
  they stand out from it; inner steps `--surface-2` `#f6eee0` (inputs, inner panels) and `--surface-3` `#ece2cf`
  (pressed states, code); hairlines `--line` `#e0d4bd`, `--line-strong` `#bfae90`. Text `#1c1a17`, `--text-2`
  `#564e43`, `--text-3` `#625a4e`; the same orange accent.
- On light, orange is too pale for text, so links and active icons use `--accent-text` (`#9c3409`), and filled red,
  amber and green badges use white text (`--on-state`). State colours are darkened (`--ok` `#0b663d`, `--warn`
  `#804905`, `--danger` `#a82535`, `--info` `#1c52ab`) so every text and state colour passes 4.5:1 on the ground and
  all three surface steps (lowest: `--text-3` on the sand ground, 5.1:1).
- Soft status fills use `--tint` 26% on light (16% on dark) so they still read against the sand ground.
- Printed paper (receipts, invoices, QR cards) is white in both themes.

## Type

One family: **Manrope** (400, 500, 600, 700, 800), default figures everywhere. Its tabular figures widen the thousands
comma ("Rs. 1, 100"), so they are not used; amount columns are right-aligned instead.
Fixed scale, ratio about 1.2: 12 / 13 / 15 (body) / 18 / 22 / 28. Labels, table heads and tags use the body face at
13px, sentence case, no tracking, never all-caps.

## Shape and space

- Spacing on a 4px grid: 4, 8, 12, 16, 20, 24, 32.
- **Chunky outlined style.** Everything you can touch has a thick ink outline (`--bw` 2px, `--outline`: near-black in
  light, black in dark) and a solid offset shadow (`--pop` 3px 3px, `--pop-lg` 5px 5px for dialogs and messages).
  Buttons are pills; on hover they lift 1px, on tap they press down into their shadow. Hairlines stay only between rows
  inside a list or table.
- Radius: 12 (inputs, small controls), 18 (cards, tiles), 24 (dialogs, panels), pill (buttons, tabs, chips, badges).
- **Soft status fills** (`--tint`: 16% dark, 26% light) replace grey cards where colour carries meaning: kitchen tickets
  by column (new blue, preparing amber, ready green, late red), occupied tables amber, menu tiles by their category,
  order-type cards, the demo role picker (owner orange, cashier green, kitchen blue), figure cards, messages by
  kind.
- The current page, the active tab and the chosen option are filled orange with ink text.
- Controls are 40px tall (32px small); on touch screens every target is at least 44px.

## Shell

- **Sidebar** (232px) on screens 960px and wider: the restaurant name, the role's destinations with line icons, then
  today's sales, the signed-in user and Sign out at the bottom (Back in the demo, which returns to the role picker).
- **Under 960px**: a top bar with the name and a menu button; the same nav opens as a drawer.
- The kitchen login has one destination, so it gets the top bar only.
- Content pages scroll inside `main`; working screens (New order, Floor plan, Kitchen, WhatsApp) fill the height.

## Components

- **Buttons**: `primary` (accent fill, the one main action per area), `ghost` (surface fill with a hairline),
  `danger` (red text on ghost). `sm` for dense rows. Every button has hover, active, focus-visible and disabled states.
- **Tabs**: a segmented row that scrolls sideways on small screens rather than wrapping.
- **Tables**: inside `.card`, which scrolls sideways when the table is wider than the screen.
- **Dialogs**: centred, max 480px wide; on phones they become full-width sheets from the bottom.
- **Status pills**: soft fill plus text colour; never a coloured dot by itself.
- **Icons**: the line icons in `client/src/ui.jsx` (`<Icon name="…" />`), 1.75px stroke. Emoji appear only where they
  are the owner's data (menu items, floors), never as interface icons.

## Notifications

Never the browser's own `alert()`, `confirm()` or `prompt()`. Use `client/src/notify.jsx`:

- `toast(message)` (green, 2.6 s), `toast(message, 'info')` (blue, 3.5 s), `toastError(message)` (red, 6.5 s).
  Messages stack at the top centre (below the top bar on small screens), at most four, slide down to enter and fade up to
  leave, and close on tap. The same message twice refreshes the one already showing instead of stacking.
- `await confirmBox('Delete Fries?')` returns true or false. A message starting with Delete, Cancel, Remove, Unlink, Stop
  or Refund gets a red action button named after that verb and "Keep it" as the way out.
- `await promptBox(message, { title, placeholder, defaultValue, required, multiline })` returns the text or null.
- Dialogs open with focus on the field or the main button; Enter confirms, Esc or a tap outside cancels.

## Responsive

Breakpoints: 560px (phone), 960px (tablet: drawer nav), 1200px (wide). Nothing may scroll sideways at 390px wide except
a table inside its own card.

- New order: menu and cart side by side from 960px; below that the cart is a sheet opened from a sticky order bar.
- Kitchen board: three columns from 960px, stacked below.
- WhatsApp: list and conversation side by side from 760px; below that, one at a time with a back button.
- Tables: under 760px every `.tbl` becomes stacked cards (one card per row, column names written beside the values,
  actions along the bottom). `watchTables()` in `ui.jsx` copies each column heading onto its cells; no screen code needed.
- Wide monitors: content pages stop at 1280px and centre; the gutters grow, the columns do not stretch.
- Short screens (a phone held sideways): the open cart scrolls, with Cancel, Send to kitchen and Pay pinned at its bottom.
  The kitchen and delivery boards fit as many 260px columns as the width allows.
- Checked at 320, 390, 600, 768, 1024, 1440 and 1920 wide, plus 844 x 390 sideways.

## Motion

State changes only, 120 to 200ms, `transform` and `opacity` (plus colour and border-colour on hover). No entrance
animations on page load. Everything respects `prefers-reduced-motion`.
