# DESIGN.md: Ariane

## Source

- Primary product reference: https://speko.ai/
- Interaction reference: https://ui.aceternity.com/components/resizable-navbar
- Editorial reference: https://herin.vercel.app/ and the private `herin7/pfolio` repository supplied by its owner
- Captured: 2026-08-26
- Evidence: Firecrawl branding, imagery and full-page captures; live browser inspection; source review of the supplied portfolio repository
- Scope: Visual inspiration only. Do not reuse third-party trademarks, copy, illustrations, or proprietary assets.

## Reference Screenshots

![Speko landing-page reference](../../.firecrawl/speko-browser-reference.png)

![Herin portfolio editorial reference](../../.firecrawl/pfolio-live-screenshot.png)

![Aceternity resizable-navbar reference](../../.firecrawl/aceternity-nav-screenshot.png)

Use this capture only as research into hierarchy, whitespace and density. Ariane
deliberately uses a different composition, palette pairing and signature motif.
The capture remains ignored by Git.

## Design Summary

A cinematic civic-product surface on warm off-white paper. Deep indigo carries
actions while a coral thread is the signature motif. Soft aurora gradients,
glass depth and selective glow make the interface feel alive without weakening
trust. The landing page pairs an asymmetric promise with a connected-route
artifact, then turns product mechanics into evidence-like panels. The interface
should feel precise, dimensional and human without becoming a developer console
or a government portal.

For Ariane, the emotional promise is clarity: one verified route through a
fragmented public-service system. Proof, uncertainty, and source status are
product features and should remain visible.

## Design Tokens

### Colors

- Canvas: `#faf9f6`
- Elevated surface: `#ffffff`
- Primary ink: `#0e1512`
- Secondary ink: `#53605a`
- Primary indigo: `#5550d8`
- Deep indigo: `#413bb8`
- Electric violet: `#7a62f4`
- Aurora lilac: `#cfc9ff`
- Thread coral: `#ef5a3c`
- Warm flare: `#ff9c76`
- Soft indigo: `#eeecff`
- Hairline: `rgba(14, 21, 18, 0.14)`
- Status colors stay semantic and muted; they never compete with the route thread.

### Typography

- Display and hero: Stack Sans Notch, 520–650 weight, tight tracking. Its
  notched construction is Ariane's distinctive graphic voice.
- Body and UI: Elms Sans, with Inter as the precision fallback.
- Small evidence metadata: Inter or the existing monospace stack.
- Hero: `clamp(3rem, 7.2vw, 5.8rem)`, approximately `0.98` line-height.
- Section title: `clamp(1.8rem, 3vw, 2.6rem)`.
- Body: 16px; hero support copy: 18–20px.

### Spacing And Layout

- Main canvas: maximum width 1160px, with 20–32px side padding.
- Reading content: maximum width 760px.
- Hero: asymmetric two-column composition on desktop and a single column on mobile.
- Use an 8px spacing base; section gaps are 96–144px on desktop.
- Controls and cards use 14–28px radii with gradient hairlines and layered,
  tinted shadows.
- Prefer open whitespace and dividers; depth comes from light, blur and color,
  not from filling every gap with another card.

## Components

- Header: a floating glass pill on load. After the first reading threshold it
  expands to the viewport edges and exposes a coral scroll-progress filament.
- Primary button: indigo-to-violet gradient, white text, luminous edge and a
  controlled hover sheen.
- Secondary button: white surface, hairline border, dark text.
- Search: one large elevated field with the action inside the same shell.
- Evidence panels: glass-white gradient, spectral border and compact metadata.
- Service cards: numbered and roomy with a directional gradient wash and small
  depth shift; title and short description only.
- Route visual: a continuous coral thread with numbered knots; illustrative, not a
  source of government facts.
- Footer: generous top border and simple grouped navigation.

## Page Patterns

1. Header
2. Asymmetric hero promise and an Ariane route artifact
3. One dominant action
4. Compact product proof or route visualization
5. Featured journeys
6. Trust principles and uncertainty model
7. Multi-column footer

Citizen journey pages keep a narrower reading measure. Admin graph and coverage
surfaces may expand to the full canvas.

## Content Style

- Lead with the citizen outcome, not the architecture.
- Short declarative headings: “One request. One route.”
- Explain trust plainly: “If we cannot verify it, we say so.”
- Avoid civic-tech jargon, model terminology, and inflated claims.
- Government facts must remain graph-derived and cited.

## Agent Build Instructions

- Use Ariane’s name, thread motif, content, and data only.
- Indigo owns actions; coral appears only as Ariane’s route thread and knots.
- Use whitespace as structure, then add atmosphere through low-opacity auroras,
  glow borders and spotlight falloff—not ornamental filler cards.
- Borrow interaction categories, never component styling wholesale: resizable
  navigation, hover-border gradients, spotlight depth and spatial transitions
  must be recolored and reshaped around Ariane's route-thread metaphor.
- Preserve keyboard focus, zoom support, reduced motion, and mobile sticky actions.
- Do not place government requirements, fees, offices, or timelines in JSX.
- Do not change backend routes while implementing this design.

## Rerun Inputs

```text
workflow: firecrawl-website-design-clone
source_url: https://speko.ai/, https://ui.aceternity.com/components/resizable-navbar, https://herin.vercel.app/
target_stack: Next.js 15, React 19, plain CSS
output: apps/web/DESIGN.md
```
