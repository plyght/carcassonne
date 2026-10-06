# UI audit: the chrome around the board

Scope: every screen at desktop 1440×900, laptop 1280×800 and phone 390×844, light and
dark (captured with `apps/web/e2e/design-audit.ts`, Playwright Chromium). The board art
and the 3D renderer are out of scope; this is about the panels, pages and controls
around them.

Tags: **[shadcn]** stock/generic look · **[align]** misaligned or inconsistent geometry ·
**[type]** hairline, tiny or low-contrast text · **[consistency]** one-off radii, shadows,
states · **[dark]** dark-mode specific · **[mobile]** phone specific.

Status: each finding ends with what was done; the design language and tokens are at the
bottom, followed by what is left.

## App-wide

| # | Finding | Tags | Status |
|---|---|---|---|
| A1 | Three parallel style systems: the DialKit tokens (`tokens.css`) on setup/settings/online, stock shadcn utilities (`rounded-2xl border border-border bg-card/80 shadow-sm`) on menu, replays, ranked, profile, tutorial, lobby, end summary, and inline styles in the boards' zoom buttons. | shadcn, consistency | Fixed: one token file + `ui.css` / `chrome.css` / `hud.css` / `screens.css`; all pages use them. |
| A2 | Cards are white rounded boxes with a 1 px grey border and a generic `shadow-sm`; some sit inside other bordered boxes (lobby seats, rules). | shadcn | Fixed: cardstock sheets (grain, soft inner shading, warm 3-level elevation), no borders, nothing nested. |
| A3 | Radii everywhere from 8 to 40 px (`rounded-lg/xl/2xl/3xl/[2rem]/[2.5rem]/full`). | consistency | Fixed: `--r-inner` 6, `--r-control` 8, `--r-sheet` 16 (+ round for dots). |
| A4 | Shadows: `shadow-sm/md/lg/2xl`, `shadow-primary/25`, `--sheet-lift` + ad-hoc stacks. | consistency | Fixed: `--elev-1` (resting), `--elev-2` (floating HUD), `--elev-3` (popover/dialog), warm-tinted, dark variants. |
| A5 | Focus rings: some `ring-1 ring-ring/50` (barely visible), some outline, most custom links none. | consistency | Fixed: one 2 px `--focus` outline at 2 px offset on every interactive element. |
| A6 | Press/hover states missing on most links and buttons outside DialKit (menu cards lift, nothing else responds to press). | consistency | Fixed: every `.carc-btn`, icon button, card link, emoji, figure choice has hover + `scale(--press-scale)` press; durations/easings from tokens; reduced motion zeroes the scale. |
| A7 | Next/font variables lived on `<body>`, so tokens on `:root` couldn't reference the fonts. | consistency | Fixed: font variables on `<html>`; `--font-ui / --font-serif / --font-num` tokens. |
| A8 | Muted text `oklch(0.5 …)` on parchment and `text-white/60–70` on felt/wood is under 4.5:1 in places. | type | Fixed: `--text-2` everywhere (≥ 4.5:1 on sheet and page in both themes); on-board text uses `--text-on-board` at ≥ 86 %. |
| A9 | All-caps micro labels at 10–12 px with wide tracking (`DRAW PILE`, `BOT · MEDIUM`, `FINAL SCORE`, `A TILE-LAYING CLASSIC`, stats labels, replay status). | type | Fixed: the only caps label is `.carc-eyebrow` (13 px / 600 / 0.08em); badges are sentence-case 13 px tags. |
| A10 | Sign-in/up pages are raw shadcn: bold sans "Create Account", 12 px labels, 32 px inputs with hairline borders, indigo link. `/dashboard` (after sign-up) is unstyled HTML. | shadcn, type | Fixed: cardstock auth sheet, serif heading, 14 px labels, 40 px filled fields, accent link; dashboard is a styled welcome page. |
| A11 | Shared `packages/ui` Button/Input/Label/Dropdown use 32 px heights, 12 px text, hairline borders, `ring-1` focus. | shadcn | Fixed: 40 px, 14 px, filled, token focus ring, cardstock dropdown with `--elev-3`. |

## Header

| # | Finding | Tags | Status |
|---|---|---|---|
| H1 | Hairline bottom border; nav "pill" (`bg-muted` rounded) is the stock shadcn tab. | shadcn | Fixed: printed soft edge; nav items are 40 px with an ink colour and a terracotta bookmark under the current page. |
| H2 | Theme toggle is a 32 px outlined square, Sign In an outlined pill at a different height; user menu is an outlined button with the raw name. | shadcn, align | Fixed: 40 px icon button and ghost button on one baseline; user menu shows an initial chip, name and chevron; menu items have icons. |
| H3 | No in-game variant alignment: header content is centred at 1280 px while HUD panels hug the viewport edges. | align | Fixed: in game the header spans the width with the same 12 px inset as the HUD. |

## Menu

| # | Finding | Tags | Status |
|---|---|---|---|
| M1 | Mode cards: bordered white cards, icon in a pink square that turns solid on hover, card lift on hover only. | shadcn | Fixed: cardstock card links (elev-1 → elev-2 on hover, press scale), terracotta-tinted icon well, serif title + 13 px blurb. |
| M2 | Eyebrow "A TILE-LAYING CLASSIC" is 12 px with 0.3em tracking. | type | Fixed: `.carc-eyebrow` (13 px, 0.08em). |
| M3 | Primary CTA is a 16 px-radius pill with a diffuse coloured shadow; "Continue" is outlined. | shadcn, consistency | Fixed: 48 px `.carc-btn` primary / secondary. |
| M4 | Preview frame: 8 px border plus blurred wood glow behind (`blur-2xl` decoration). | consistency | Fixed: one walnut tray (double inset ring + elev-3). |

## Setup (`/play/new`)

| # | Finding | Tags | Status |
|---|---|---|---|
| S1 | Already on DialKit tokens; fine. Mode tabs, seat rows and rule rows align on the 12 px text inset. | — | Kept; buttons now share `.carc-btn`. |

## Game HUD (2D and 3D)

| # | Finding | Tags | Status |
|---|---|---|---|
| G1 | Panel offsets are uneven: the title bar (h 52) and actions bar (h 44) differ, the left column starts at 74 px, right column 74 px but widths 300 vs auto; zoom buttons at 12 px, keyboard help at 12 px but unpadded, emoji bar centred at 12 px with 36 px buttons. | align | Fixed: `--hud-inset` 12, `--hud-gap` 8, `--hud-col` 304 (280 on tablets), `--hud-bar` 56, `--hud-pad` 12; all panels use them. |
| G2 | Title bar packs back, title, seed (11 px mono), a vertical hairline divider, turn dot with a white ring, "Your turn", clock and wifi on one line; it's wider than the score column below it. | type, align | Fixed: column-wide bar: back · title over "● Your turn ⏱ 0:09" (13 px), connection icon at the end. Seed moved to the score panel footer. |
| G3 | Score rows: 11 px category numbers with 12 px icons, 10 px uppercase "BOT · MEDIUM" pill, 10 px "you" pill, 10 px "offline", 11 px "thinking…"; meeple icons 13 px. Score numbers right-aligned per row but rows have different paddings. | type, align | Fixed: grid rows (avatar · who · total), totals on one right edge in a 24 px serif, category line 13 px with 14 px icons aligned under the name, 13 px tags ("You", "🤖 Medium", "Offline"). |
| G4 | Active player: gold 1 px border + accent fill + an infinite pulsing glow. | consistency | Fixed: gold-tinted fill with a 3 px gold rail; no looping animation. |
| G5 | Event log at 12 px muted, newest line not distinguished. | type | Fixed: 13 px, newest line in ink. |
| G6 | Tile in hand: the text column crowds the dial (12 px gap), "TILE IN HAND" caps label, inline `<kbd>` sits low. | align, type | Fixed: 16 px gap, eyebrow + 14 px status + 13 px hint on a 24 px line so the key cap centres. |
| G7 | Figure choice list: bordered rounded-xl rows, dashed "No figure", 12 px detail; "← Pick another spot" 12 px link. | shadcn, type | Fixed: 40 px filled rows (kbd · label · role), skip as an outlined ghost row, back as a compact ghost button. |
| G8 | Draw pile: count badges (10 px, black pills) overlap the tile thumbnails; caps label; the panel is unbounded and runs under the zoom buttons at 1440×900 and 1280×800. | align, type | Fixed: counts printed under each thumbnail (13 px), the pile collapses from its header, the column is capped above the bottom row and the grid scrolls. |
| G9 | Zoom buttons: three separate 34 px squares with hairline borders, text glyphs (+ − ⤢) of different optical sizes; 3D has its own copy in a different place (bottom-left, above the help). | shadcn, align | Fixed: one `BoardToolbar` for 2D, 3D and replays: a cardstock strip of three 40 px icon buttons (lucide Minus/Plus/Maximize, 16 px) at the bottom-right inset. |
| G10 | Keyboard help: 11 px white text with a drop shadow straight on the table (3D: on a black pill), kbd caps of various widths. | type | Fixed: a cardstock help strip (13 px, key caps) at the bottom-left inset, shown from 1280 px. |
| G11 | Emoji bar: 36 px buttons, "+18" as 12 px text that sits off the emoji baseline; scales 125 % on hover. | align, type | Fixed: 40 px buttons, 22 px emoji, a 40 px "more" icon button; hover scale 1.12 only on fine pointers. |
| G12 | Error and "Something went wrong" states use shadcn colours and an underlined link. | shadcn | Fixed: cardstock sheet + `.carc-btn`. |
| G13 | Loading text "Shuffling tiles…" / "Setting the table…" white text with no backing on a light table. | type | Fixed: `.carc-board-message` (dark wash, light serif). |
| G14 | 3D figure menu: 12 px detail, `hover:bg-muted`. | type | Fixed: same rows as the 2D figure list. |

## Phone HUD

| # | Finding | Tags | Status |
|---|---|---|---|
| P1 | The top bar overflows: "Your turn" is cut, the divider eats space, actions bar has 32 px buttons. | mobile, align | Fixed: title bar flexes, actions are 40 px icon buttons; the strip under it scrolls horizontally. |
| P2 | Score strip chips: 12 px names truncated to "Brother O…", 10 px "×7". | mobile, type | Fixed: 13 px names (88 px max), 20 px serif scores, active chip with a gold underline. |
| P3 | Figure choice covers the board: the panel grows to ~380 px with the dial and four 44 px rows. | mobile | Fixed: while placing a figure the dial and hint hide and the choices become one scrolling row; the panel is ~120 px. |
| P4 | Zoom buttons stack vertically over the tile panel's right edge; the tile panel is offset 64 px from the right to make room. | mobile, align | Fixed: bottom row = reactions (4 quick + more) and the horizontal toolbar, tile panel docks full-width above it. |

## Pass device, end summary, replays

| # | Finding | Tags | Status |
|---|---|---|---|
| E1 | Pass device: 12 px caps label at 60 % white, 14 px body at 70 % white on dark wood, gold pill button with a white ring. | type | Fixed: a cardstock dialog on the wood: eyebrow, serif heading, body in `--text-2`, primary 48 px button. |
| E2 | End summary: bordered dialog, 12 px caps "FINAL SCORE" at 70 % white, 12 px table header, hairline row rules, `bg-muted/40` footer bar with a hairline, mixed button styles (text link, outlined pill, filled pill). | shadcn, type | Fixed: cardstock dialog (elev-3), felt banner with 13 px eyebrow at ≥ 86 %, 13 px headers, rows grouped by spacing with the winner in gold, totals in serif on one edge, actions `.carc-btn` ghost / secondary / primary. |
| E3 | Replays list: bordered cards, 10 px uppercase status pill, 12 px meta, outlined/filled pill buttons. | shadcn, type | Fixed: cardstock rows, 13 px "Finished / In progress" tags, 13 px meta, winner bold + accent score, 40 px buttons. |
| E4 | Replay viewer: seed 11 px mono, 12 px caption, raw `<input type=range>` with accent-color, buttons at three different sizes, separate zoom buttons. | shadcn, type, align | Fixed: shared title bar + score panel, transport panel with 13 px caption, 40 px icon buttons, a styled range (terracotta fill), shared toolbar. |

## Online, lobby, ranked, profile, settings, tutorial

| # | Finding | Tags | Status |
|---|---|---|---|
| O1 | Online: room code field placeholder in tracked caps; Join/Create buttons hand-rolled. | consistency | Fixed: `.carc-field` + `.carc-btn`. |
| O2 | Lobby: 12 px caps "ROOM", invite bar is a bordered pill, seats are bordered cards inside a bordered card, "(you)" 12 px, "waiting…" 12 px, rules as a bulleted muted list. | shadcn, type | Fixed: eyebrow + serif code, invite on cardstock, seats as filled rows (open seats outlined), "You" tag, 13 px meta, rules as a definition list. |
| O3 | Ranked: bordered cards, buttons of different shapes, sign-in prompt as a bordered card with an underlined link. | shadcn | Fixed: cardstock cards with icon well, full-width 40 px buttons aligned to the bottom, a notice row. |
| O4 | Profile: stats labels 12 px caps; colour swatches with a 2 px black ring; recent games with hairline dividers and raw mode ids ("ai", "hotseat"). | type, shadcn | Fixed: eyebrow labels, serif tabular values, swatches with the seat colour ring, filled rows with readable mode names. |
| O5 | Settings: "2D/3D" tag as loose 13 px text; keyboard keys wrap. | consistency | Fixed: `.carc-tag`; keys don't wrap. |
| O6 | Tutorial: bordered cards per lesson (cards stacked in a list), 12 px footnote, CTA pill. | shadcn, type | Fixed: one sheet with lessons grouped by spacing, 13 px footnote, 48 px primary button. |

## Dark mode

| # | Finding | Tags | Status |
|---|---|---|---|
| D1 | Dark sheets and page are warm (good), but borders (`--border`) show as grey hairlines on every card; the shadcn outline buttons look like inverted greys. | dark, shadcn | Fixed: no borders; fills are warm (`--fill` from the foreground), shadows deepen in dark. |
| D2 | Draw pile exhausted tiles become dark grey squares that read as holes. | dark | Fixed: grayscale + 28 % opacity on the art only, count stays legible. |

## Fixed: the design language

A crafted tabletop rather than an admin dashboard: cardstock panels (paper grain, a soft
inner vignette, a light top edge, warm shadows, never a 1 px grey border) on a parchment
page or over the board; walnut ink for text; terracotta for the one primary action and for
selection; gold only for "your turn" and the winner; the serif (Fraunces) for headings,
scores and room codes, Geist for UI, Geist Mono for seeds and clocks. Grouping is by
spacing and filled rows, never by boxes inside boxes.

Single source of truth: `apps/web/src/components/dial/tokens.css`.

| Token group | Values |
|---|---|
| Spacing | `--sp-*` 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 |
| Radii | `--r-inner` 6 (chips, kbd) · `--r-control` 8 · `--r-sheet` 16 |
| Heights | `--h-chip` 22 · `--h-compact` 32 · `--h-control` 40 · `--h-large` 48 |
| Type | 13 / 14 / 16 / 20 / 24 (scores) / 28 / 36 / hero clamp(44–64); weights 400/500/600; `--ls-caps` 0.08em; `--ls-display` −0.015em; `.carc-num` = tabular lining numbers |
| Colour | `--text-1`, `--text-2` (≥ 4.5:1 on sheet and page, both themes), `--text-accent`, `--gold-ink`, `--text-on-board`; fills `--fill / -hover / -press / -active / -gold` |
| Elevation | `--elev-1` resting · `--elev-2` floating HUD · `--elev-3` popover / dialog (warm; deeper in dark) |
| Focus | `--focus` (= ring), 2 px outline, 2 px offset, on every interactive element |
| Motion | `--ease-out` (0.23, 1, 0.32, 1), `--ease-in-out`, `--dur-press` 120 / `-fast` 160 / `-base` 220 / `-slow` 320, `--press-scale` 0.97; both the OS setting and Settings → Motion zero the press scale |
| HUD | `--hud-inset` 12 (8 on phones), `--hud-gap` 8, `--hud-col` 304 (280 under 1024 px), `--hud-pad` 12, `--hud-bar` 56 |

Components built only from those tokens: `ui.css` (`.carc-btn` primary / secondary / ghost
/ gold, `.carc-icon-btn`, `.carc-tag`, `.carc-kbd`, `.carc-eyebrow`, `.carc-field`,
`.carc-row`, `.carc-notice`, `.carc-well`, `.carc-card-link`), `chrome.css` (header, menu,
stats, dialogs, auth, replays list, tutorial, swatches), `hud.css` (game and replay HUD),
`screens.css` (pass device, end summary, replay transport, lobby). `dial-theme.css` maps
DialKit onto the same tokens; `packages/ui` primitives use them too.

Dark mode is a warm walnut palette (page oklch 0.2 / sheet 0.26, hue 55), with fills
derived from the warm foreground instead of grey borders, deeper shadows, and key caps
that lift off the sheet.

## Verification

Re-shot every screen at the three sizes in both themes plus the 3D board
(`bun e2e/design-audit.ts --3d`), and compared side by side:

- `docs/screenshots/design-before-after-hud.png` (desktop and laptop HUD, figure choice)
- `docs/screenshots/design-before-after-mobile.png` (phone HUD, light and dark)
- `docs/screenshots/design-before-after-end.png` (end summary, replay viewer)
- `docs/screenshots/design-before-after-dark.png` (3D HUD and replays in dark)
- `docs/screenshots/design-before-after-pages.png` (menu, lobby, sign-up)

`bun run check-types`, `bun run test`, the web build, `bun run e2e` (8/8) and
`bun run e2e:dialkit` pass; the lobby's "(you)" text became a tag, so the online e2e now
waits on `data-testid=my-seat`.

## Remaining

- The DialKit "Table" popover is 336 px wide, a little wider than the 304 px HUD column,
  so its left edge doesn't line up with the actions bar (right edges do). Narrowing it
  crowds the 3D quality / motion segmented rows.
- One draw-pile thumbnail (a river tile) renders blank under the 3D styles; that comes from
  the tile-art pipeline, not the HUD, and was the same before.
- The 3D figure menu (opened by clicking a placed tile on the 3D board) uses the new rows
  but wasn't in the screenshot pass because the software renderer is too slow here.
- Phones still have no top-level navigation besides the menu (the header nav hides under
  768 px); the menu's mode cards cover every destination.
