# MinmoPitwallUI — usage conventions

`MinmoPitwallUI` is a small set of **presentational** pit-wall / cockpit
telemetry components (an F1-style dark racing HUD): `PanelTitle`, `StatRibbon`,
`MetricTile`, `WeatherIcon`, `TrackStrip`. They are pure props-in components —
**no provider, no context, no internal state**. Load the bundle and read them
off `window.MinmoPitwallUI`.

## Theme & setup

- **No provider/wrapper is required.** Components render correctly as soon as
  `styles.css` is on the page.
- **They are built for a DARK surface.** Each card/tile supplies its own dark
  background, but place them on a dark page/panel (e.g.
  `background: var(--bg-primary)` = `#131314`, or `var(--bg-panel)`). On a light
  background the cyan/lime accents and muted labels lose contrast.
- Mount into a dedicated node, not the host React root (see README "Loading").

## The styling idiom — props, not classes

There are **no exposed CSS classes**. Style the components through their
**props**, and style your own surrounding layout with the design **tokens** (CSS
custom properties).

- **`tone` is the accent lever.** `PanelTitle`, `StatRibbon`, and `MetricTile`
  all take `tone: 'primary' | 'secondary' | 'tertiary' | 'neutral'`. It drives
  the accent color: `primary` = cyan (`--accent`), `secondary` = salmon
  (`--accent-soft`), `tertiary` = lime (`--accent-lime`), `neutral` =
  `--text-primary`. Use it to signal status (neutral baseline, tertiary = good /
  faster, secondary = warning).
- **Density props:** `StatRibbon` takes `dense`, `MetricTile` takes `compact`
  for tighter dashboard packing.
- **`StatRibbon` value** uses the racing font and is the focal point; its
  `detail` prop is hidden on wide layouts by design (shown only on narrow/mobile).
- **`WeatherIcon` inherits size + color from its parent** (it renders 100%×100%
  with `currentColor`). Always wrap it in a sized, colored box:
  `<div style={{ width: 28, height: 28, color: 'var(--accent)' }}><WeatherIcon weather="storm" /></div>`.
  Accepted `weather` values: `clear`, `light cloud`, `overcast`, `storm`
  (anything else renders the rain icon).
- **`TrackStrip` is meter-based.** Feed it raw telemetry units: `trackLength`,
  `sectorSplits` (`[end of S1, end of S2]`) and per-item `distance`, all in
  meters — it converts to percentages internally. Driver dots carry their own
  `color` (team color; falls back to the tone accent); `tone` colors the
  focused-driver ring and the start/finish marker. It is a full-width bar —
  give it a wide container (≥ 560px; below that, dense corner labels crowd).

## Tokens (use these for your own layout)

Names are verbatim from the source theme — defined in `_ds_bundle.css` `:root`.
The ones you'll reach for most:

- **color:** `--accent` (cyan), `--accent-lime`, `--accent-soft`, `--accent-red`,
  `--text-primary`, `--text-secondary`, `--text-muted`
- **surface:** `--bg-primary`, `--bg-panel`, `--bg-surface`, `--bg-panel-border`
- **type:** `--font-racing` (Space Grotesk — numbers/values), `--font-body`
  (Inter — labels)
- **radius / space:** `--radius-sm` / `-md` / `-lg`, `--spacing-xs` … `--spacing-xl`

## Idiomatic composition

```jsx
const { PanelTitle, StatRibbon, MetricTile } = window.MinmoPitwallUI;

<div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 'var(--radius-md)', display: 'grid', gap: 12 }}>
  <PanelTitle title="Sector Times" tone="primary" detail="Lap 24" />
  <StatRibbon label="Last Lap" value="1:24.318" detail="" tone="tertiary" />
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
    <MetricTile label="Tyre Temp" value="92°C" tone="primary" note="Front Left" />
    <MetricTile label="ERS Store" value="4.0 MJ" tone="tertiary" compact />
  </div>
</div>
```
