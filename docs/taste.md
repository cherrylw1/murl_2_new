# CONDUCTOR — taste.md
### Design philosophy & taste. Read this before touching a pixel.
*Inspiration: Nothing (and its Teenage Engineering roots). v1.0 · 20 June 2026*

---

## The one-line brief

**Conductor is a transparent case over a swarm of autonomous web agents.** You should be able to look into it and see the machine thinking — calmly, beautifully, without noise.

This is why Nothing is the right north star and not a cosmetic mood-board choice. Nothing's whole thesis is *transparency — turning the internal logic of the device into something you can see, with rhythm and structure imposed on it*. That is, almost word for word, what an agent harness is for. We are not borrowing Nothing's look. We are building the product Nothing's philosophy describes.

---

## What we learned from studying Nothing (the principles, distilled)

1. **Transparency as identity.** Nothing shows the screws, coils, and ribbon cables on purpose — "inside-out" design, "industrial design as dialogue, not disguise." → Conductor shows the agent's thoughts, actions, DOM state, and live browser. The workings *are* the interface.
2. **Constraint is the engine.** From Teenage Engineering: a tiny fixed palette, true black for maximum contrast, brutalist honesty about what a thing is. The extreme limitation is *why* it's instantly recognisable. → We will have very few colors, few type sizes, one accent, one grid. The discipline is the brand.
3. **Status as a language of light, not text.** The Glyph Interface communicates through ambient, calm light cues so you can stay present and glance, not stare. → Agent status is rendered as breathing light, not paragraphs. You glance at the wall, read the room, walk away.
4. **Dots, used with restraint.** The NDOT dot-matrix face is the signature, but Nothing OS 3.0 deliberately pulled it back to "tasteful use" alongside a clean sans. → Dots are for *data and status and numerals* — agent IDs, counters, costs, timers. Never for body text. Restraint is the difference between iconic and gimmick.
5. **Negative space is confidence.** Nothing "bets you're smart enough to appreciate negative space." → We never fill a panel just because it's there. Empty space is a design element, not a vacancy.
6. **Make it an object that deserves the desk.** Pei: "an object that deserves to sit on your desk." → Conductor should feel like a crafted instrument (think OP-1), not a SaaS dashboard. Tactile, precise, quietly premium.
7. **Calm tech / tech joy.** Nothing exists to "make tech fun again" and reduce screen anxiety. → The harness runs itself; the UI's job is to be glanceable and reassuring, not to demand attention.

---

## The taste rules (do this)

- **Monochrome canvas, one signal color.** True-black/carbon surfaces, white and grey type. Red appears **only** to mean *a human is needed / over budget / failed*. If red is everywhere, it means nothing.
- **Express state through brightness, not hue.** Idle = dim. Active = bright/white glow. Needs you = red. This is the Glyph language: light intensity carries meaning.
- **Dots for the machine's voice, sans for ours.** Numerals, statuses, IDs, timers, costs → dot-matrix face. Anything a human reads as a sentence → clean grotesk.
- **Snap everything to the dot-grid.** A faint background dot-grid is the substrate; every element aligns to it. This gives the "rhythm and structure" Nothing talks about.
- **Frosted transparency over the grid.** Panels are subtly translucent so the dot-grid shows through — literally "see the workings." Layering, not opacity.
- **Hairlines, not heavy borders.** 1px aluminium-grey dividers. Structure through line weight and spacing, not boxes and shadows.
- **Motion is calm and deliberate.** One orchestrated moment (a launch dot-ripple, a status breath) beats scattered effects. transform/opacity only. Respect `prefers-reduced-motion`.
- **Sound is part of the design.** Teenage Engineering's lineage is audio. Tiny, optional, tasteful ticks on state changes; the Wallet Guard's acoustic alert is a feature, not a bug.
- **Copy is plain and human.** "Resume," not "Re-initialise context." Errors explain what happened and what to do, in the product's voice, without apologising. Empty screens invite the next action.

---

## The anti-patterns (never do this)

- **Don't ship the generic "dark mode + neon accent" template.** Yes, our canvas is near-black with one accent — but the *signature* is the dot system, the Glyph status-light wall, and the transparency layering. If it could be mistaken for any other dark dashboard, it has failed. Lean hard on the distinctive elements.
- **Don't over-dot.** Dot-matrix body text is unreadable and tacky. Dots are a spice.
- **Don't use Nothing's real fonts or logo.** `NDot` / `NDOT 55` and the Nothing wordmark are their property. Use the OFL look-alikes in `design.md`. We are *inspired by*, not *impersonating*.
- **Don't add a second accent color.** Success and progress are expressed in white/grey brightness. The moment you add green/blue/amber, you've broken the constraint that makes it recognisable.
- **Don't decorate.** Every line, dot, and label must encode something true (a real status, a real count, a real boundary). No ornamental numbering, no decorative glows.
- **Don't crowd.** If a panel feels full, remove something. "Before you leave the house, take one thing off."

---

## The signature (the one thing we'll be remembered for)

**The Glyph Wall.** The agent dashboard is not a list of cards — it is a wall of breathing light cells, one per agent, each pulsing with its activity, dimming when idle, and glowing red the instant it needs a human. Behind it, the dot-grid shows through frosted panels so you can see the machine working underneath. From across the room you can read the state of your entire swarm at a glance — exactly what the Glyph Interface does for a phone face-down on a table.

Spend the boldness here. Keep everything around it quiet.

---

## Self-critique checklist (run before calling any screen "done")

- [ ] Could this be mistaken for a generic dark dashboard? If yes, the dot/Glyph/transparency signature isn't pulling its weight.
- [ ] Is red doing exactly one job (needs-human / over-budget / failure)?
- [ ] Is every dot-matrix element actually data or status (not prose)?
- [ ] Is there one memorable moment, and is everything else quiet?
- [ ] Does it survive at mobile-ish widths, with keyboard focus visible and reduced-motion respected?
- [ ] Can I remove one element and lose nothing? Then remove it.
