# CONDUCTOR — design.md
### The concrete design system. Build from this exactly.
*v1.0 · 20 June 2026 · Read `taste.md` first for the why.*

---

## 1. Color tokens

A deliberately tiny palette. Five named values + one functional glow. **Red is the only chroma and carries one meaning.**

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0A0A0A` | App canvas (true-black-adjacent; softer than `#000` for a desktop panel) |
| `well` | `#000000` | Deepest wells — the live browser frame, video/playback area |
| `carbon` | `#161616` | Raised surfaces: cards, the Glyph Wall cells, modals |
| `aluminium` | `#8A8A8A` | Secondary text, hairlines, idle iconography (TE "aluminium") |
| `chalk` | `#FAFAFA` | Primary text, active iconography, the white "Glyph glow" |
| `signal` | `#D71921` | **The only accent.** Needs-human / over-budget / failure. Never decorative. |

Functional brightness ramp (state via brightness, per the Glyph language):
- **Idle** → text/icon at `aluminium`, cell background `carbon`.
- **Active** → text/icon at `chalk`, cell carries a soft white glow (`box-shadow: 0 0 24px rgba(250,250,250,.12)`).
- **Needs you / error** → `signal`, with a slow pulse.

Transparency (the "see the workings" layer): panels are `carbon` at ~88–92% opacity over the dot-grid, with a light backdrop-blur. Never fully opaque.

```
--c-ink:        #0A0A0A;
--c-well:       #000000;
--c-carbon:     #161616;
--c-aluminium:  #8A8A8A;
--c-chalk:      #FAFAFA;
--c-signal:     #D71921;
--c-panel:      rgba(22,22,22,0.90);   /* carbon @ 90% */
--c-hairline:   rgba(138,138,138,0.18);
--glow-active:  0 0 24px rgba(250,250,250,0.12);
--glow-signal:  0 0 20px rgba(215,25,33,0.30);
```

---

## 2. Typography

Three roles. **Dots speak for the machine; sans speaks for us; mono carries raw data.** Sans and Mono fonts are OFL. Dot font is **LED Counter 7** by Sizenko Alexander (Style-7) with its license readme bundled locally. **Do not use Nothing's NDot / NDOT 55.**

| Role | Font (OFL) | Used for |
|---|---|---|
| Signature / dot | **LED Counter 7** (or **Departure Mono**) | Agent IDs, counters, costs, timers, status words, big numerals, the Glyph readouts. Restraint — never body. |
| Body / UI | **Geist Sans** (fallback Inter) | All sentences, labels, buttons, settings, prose |
| Data / mono | **Geist Mono** (fallback JetBrains Mono) | Logs, JSON, selectors, URLs, code, the action stream |

Type scale (desktop, 4px-based rhythm):

```
display-dot   28 / 32   LED Counter 7   (hero numerals, run cost, big status)
title         18 / 24   Geist Sans 600
body          14 / 20   Geist Sans 450
label         12 / 16   Geist Sans 500   uppercase, +6% tracking
data          12 / 18   Geist Mono 400
micro-dot     10 / 12   LED Counter 7    (cell labels, tiny counters)
```

Rules: sentence case for body and buttons; UPPERCASE only for `label` (eyebrows, section tags). Tracking opens slightly on dot and label faces, never on body.

---

## 3. Layout & grid

- **Substrate:** a faint dot-grid across the whole canvas — `aluminium` dots at ~6% opacity on an 8px lattice. Everything aligns to it.
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32 / 48. No arbitrary values.
- **Radius:** one value — `6px` — on every surface. (Constraint = identity.) Live browser frame and playback well use `8px`.
- **Dividers:** 1px `--c-hairline`. No drop shadows except the two functional glows.

### Main window wireframe

```
┌──────────────────────────────────────────────────────────────┐
│ ●●●        CONDUCTOR · 3 agents live            ⓘ  ⚙        │  ← title bar (hidden chrome, custom traffic lights)
├────────────┬─────────────────────────────────────────────────┤
│            │  THE GLYPH WALL                                   │
│  ▸ Runs    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  ▸ Recipes │  │  ◉ A1  │ │  ○ A2  │ │  ◉ A3  │ │  ＋ new │    │  ← breathing status cells
│  ▸ Schedule│  │ ACTIVE │ │ IDLE   │ │ ⚠ YOU  │ │        │    │     (white glow / dim / red pulse)
│  ▸ Library │  └────────┘ └────────┘ └────────┘ └────────┘    │
│            │                                                   │
│  ── ── ──  │  DETAIL · Agent A3                                │
│            │  ┌─────────────────────────┐ ┌───────────────┐  │
│  ⚙ Settings│  │  live browser (well)    │ │ action stream │  │  ← frosted panels over dot-grid
│            │  │  [breakpoint: solve →]  │ │ (mono data)   │  │
│            │  └─────────────────────────┘ └───────────────┘  │
│            │  ◀───────  playback scrubber  ───────▶  $0.04    │  ← time-travel deck + cost (dot face)
└────────────┴─────────────────────────────────────────────────┘
```

---

## 4. Signature component — the Glyph Wall cell

The thing we'll be remembered for. One cell per agent.

- Surface `carbon`, radius 6px, 1px hairline.
- A single status **dot** top-left: `aluminium` (idle) → `chalk` + `--glow-active` (active, slow breath 3s) → `signal` + `--glow-signal` (needs-you, 1s pulse).
- Agent ID in `micro-dot` (LED Counter 7): `A1`, `A2`…
- One-line current action in `data` mono, truncated.
- Live counter row in dot face: rows extracted · turn n/5 · cost.
- The whole cell is glanceable from across the room — that's the test. No buttons on the cell face; click to open detail.

Breathing animation (active):
```
@keyframes breath { 0%,100% { opacity:.55 } 50% { opacity:1 } }
/* 3s ease-in-out infinite; disabled under prefers-reduced-motion */
```

---

## 5. Other components (quick specs)

- **Buttons.** Primary = `chalk` text on `carbon` with hairline; hover lifts to `--glow-active`. Destructive/alert = `signal` text on transparent, `signal` hairline. No filled-red buttons (red is a signal, not a surface). Label = sentence case verb ("Resume", "Merge data", "Run").
- **Action stream.** Mono `data`, one line per step: `▸ click  "Load more"`. Thought lines dimmed to `aluminium`, action lines `chalk`. Auto-scroll with a pause-on-hover.
- **Playback scrubber.** Horizontal track of frame ticks (dots). Current frame = `chalk` dot. Scrub to load that screenshot + its thought/action. Cost-to-date in dot face on the right.
- **Breakpoint panel.** When paused: live embedded browser in a `well` frame, a `signal`-outlined banner "A human is needed — solve and resume", one primary "Resume" button. Calm, not alarming.
- **Wallet Guard alert.** Inline `signal` banner + optional acoustic tick: "Agent A2 repeated the same 3 actions 4×. Paused to protect your budget." Plain, specific, actionable.
- **Empty states.** Dot-grid with a single dimmed line of guidance: "No runs yet. Give an agent a URL and a goal." An invitation, never a shrug.
- **Settings.** `label` section tags, hairline rows, BYOK keys masked. Quiet and dense but breathable.

---

## 6. Motion

- **Launch ripple:** on first paint / new run, dots ripple outward once from the trigger point (echoes Nothing's unlock ripple). One moment, then stillness.
- **Status breath:** active cells breathe (§4). The only ambient motion.
- **Transitions:** 180–240ms, `cubic-bezier(0.2, 0, 0, 1)`, transform/opacity only — never animate layout/size that triggers reflow.
- **Reduced motion:** all breathing/rippling disabled; state shown by static brightness/red only.

---

## 7. Tailwind config (drop-in starting point)

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0A', well: '#000000', carbon: '#161616',
        aluminium: '#8A8A8A', chalk: '#FAFAFA', signal: '#D71921',
      },
      fontFamily: {
        dot:  ['"LED Counter 7"', 'monospace'],
        sans: ['"Geist Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'monospace'],
      },
      borderRadius: { DEFAULT: '6px', well: '8px' },
      boxShadow: {
        active: '0 0 24px rgba(250,250,250,0.12)',
        signal: '0 0 20px rgba(215,25,33,0.30)',
      },
      backgroundImage: {
        dotgrid: 'radial-gradient(rgba(138,138,138,0.06) 1px, transparent 1px)',
      },
      backgroundSize: { dotgrid: '8px 8px' },
      letterSpacing: { label: '0.06em' },
    },
  },
}
```

Frosted panel utility:
```css
.panel {
  background: var(--c-panel);
  backdrop-filter: blur(8px);
  border: 1px solid var(--c-hairline);
  border-radius: 6px;
}
```

---

## 8. Quality floor (non-negotiable before ship)

- Responsive/usable down to a narrow window.
- Visible keyboard focus (a `chalk` 1px ring, never removed).
- `prefers-reduced-motion` fully respected.
- Contrast: body text `chalk` on `ink`/`carbon` passes AA.
- One radius, one accent, three fonts, six colors — if a new value sneaks in, justify it or delete it.

> The discipline is the design. When in doubt, remove one thing.
