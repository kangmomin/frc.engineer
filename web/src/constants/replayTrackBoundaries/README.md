# Replay road boundaries

The registered references cover **all 24 canonical F1 25 circuits supported by
this application**. Twenty-two contain the complete main route; Suzuka and Las
Vegas have explicitly omitted intervals. All use signed left/right white-line
waypoints from EA RaceNet response bodies acquired on 2026-09-09. Pits, runoff,
kerbs and walls are not supplied. Game patch and physical/interpolation error
are unknown and labelled as such. These are not F1 26 boundary assets.

## Acquisition and identity audit

Sequential requests to the F125 spline endpoint for API IDs `00` through `42`
produced 30 usable response bodies. IDs `08`, `21`–`25`, `33`–`38` and `42` did
not produce usable JSON bodies in this acquisition; they are not registered.
API `01` (Paul Ricard), `18` (Sochi), `28` (Portimao), and reverse layouts
`39`–`41` were retained as downloaded sources only. The first three have no
supported canonical identity here; the reverse layouts conflict with the
project's current F1 25 format registry. This acquisition does not resolve that
format mismatch or establish F1 26 compatibility.

**RaceNet IDs are not canonical telemetry IDs.** Identity is established from
explicit `name`/`trackId` objects in the public RaceNet client:
`https://racenet.com/static/js/48.bb8e9ff7.chunk.js`.
The response's `track.name = default` and reported distance cannot identify a
circuit. For example, API `10` is Spa, while canonical `10` is Monza; API `31`
is Las Vegas and API `32` is Qatar. Never infer identity from filenames or lap
length alone. The exact mapping, source-body hashes, audit date and excluded
source link IDs are pinned in `../../../scripts/replay-boundary-sources.json`.

| RaceNet API ID | Canonical ID | Circuit | Main route |
|---|---|---|---|
| 00 | 0 | Melbourne | Complete |
| 02 | 2 | shanghai | Complete |
| 03 | 3 | Bahrain | Complete |
| 04 | 4 | Catalunya | Complete |
| 05 | 5 | Monaco | Complete |
| 06 | 6 | Montreal | Complete |
| 07 | 7 | Great Britain | Complete |
| 09 | 8 | Hungaroring | Complete |
| 10 | 9 | Spa Francorchamps | Complete |
| 11 | 10 | Monza | Complete |
| 12 | 11 | Singapore | Complete |
| 13 | 12 | Suzuka | Partial |
| 14 | 13 | Abu Dhabi | Complete |
| 15 | 14 | USA | Complete |
| 16 | 16 | Brazil | Complete |
| 17 | 17 | Austria | Complete |
| 19 | 19 | Mexico | Complete |
| 20 | 20 | Baku | Complete |
| 26 | 23 | Zandvoort | Complete |
| 27 | 24 | Imola | Complete |
| 29 | 25 | Jeddah | Complete |
| 30 | 26 | Miami | Complete |
| 31 | 28 | Las Vegas | Partial |
| 32 | 27 | Qatar | Complete |

## Coverage and geometry audit

Every registered response has an explicitly closed `track` route, separate
from its pit route. Source links establish ordering; neither gate array order
nor nearest-point matching is used to reconstruct the route. Retained road
patches pass the actual runtime loader's strict convexity and global X/Z
nonoverlap checks. Heights and original signed offsets are preserved, with
piecewise-linear interpolation between gates. Main gate gaps can approach
139 m, so passing these geometric checks does not quantify edge accuracy.

- **Suzuka (canonical 12 / API 13):** source links `168` and `302` overlap in
  X/Z at the overpass. Both levels are omitted; the remaining 354 patches are
  split into three continuous segments. Height-based road selection is not
  available in this renderer.
- **Las Vegas (canonical 28 / API 31):** source gates `96`–`108` contain normals
  with lengths 1.53–9.50, unlike unit normals elsewhere. Applying these as road
  edges creates widths up to 113 m and invalid/overlapping patches. Do not
  normalize them or invent replacements. Links `94`–`109` are conservatively
  omitted: the union of all original overlapping pairs and patches touching
  suspect gates. The remaining 330 patches form two continuous segments.
- The other 22 main routes have convex, nonoverlapping patches without omitted
  main links. Pit routes remain excluded for every circuit.

The two partial assets declare `coverage: main-circuit-partial`; both main
and overview maps preserve the gaps, and the viewer explains the omissions.
Unfilled areas are unknown coverage, not available driving space.

The F125 API family's game-world XYZ coordinates are used unchanged
as reference coordinates for F1 25 replays. Client metadata establishes track
identity and the source establishes edge units/formula, but independent replay
landmark alignment was only checked for Silverstone, as described below. No
asset claims a verified patch revision or physical boundary-error bound.

## Silverstone source audit

- Source: `https://web-api.racenet.com/api/F125Stats/performanceAnalysis/spline?trackId=07`
- Raw response SHA-256: `948dd2d2598fa3db6083995f8251527dd44d989956cffb44040bbd64beda694a`
- Source identifies a 5891 m circuit, 434 gates, 435 links and separate `track`
  and `pit` routes. Source track name `default` is not a patch identifier.
- The `track` route explicitly links gates 340 → 0 → … → 340 in links 0–340.
  All 341 main-road quadrilaterals are convex and have disjoint X/Z interiors.
  The generated 342 sections retain the verified closing link.
- Each edge is `position + normal * signed white-line length`, including Y.
  Read the exact `left_white_line`/`right_white_line` names; do not use racing
  limits, track limits or runoff. The source's left offset is occasionally
  positive, so neither its sign nor road symmetry can be assumed.
- This formula was confirmed in the public RaceNet client
  `https://racenet.com/static/js/48.bb8e9ff7.chunk.js`, gate helper module 545.
  That client also has a separate Catmull-Rom rendering helper. This asset
  preserves the supplied gate edges with **piecewise-linear interpolation**;
  it does not claim to reproduce the smoothed client mesh or a surveyed edge.
- Main gate spacing is 8.72–59.75 m. White-line cross-section width is
  11.86–17.14 m. `sections[].distance` is cumulative gate-to-gate 3D chord length
  for ordering, not official lap distance or a start/finish anchor.
- A separately stored F1 25 Silverstone outline (256 points) agrees with the
  source main-route polyline without rotation, translation or scaling: nearest
  distance median 0.51 m, 95th percentile 2.15 m, maximum 9.29 m. A driven
  outline supports coordinate alignment but cannot establish boundary error.
- The pit route departs gate 292 and rejoins gate 61. Including it creates 71
  overlapping main/pit patch pairs at shared entry/exit road. It is omitted
  rather than joining gates by array order or weakening overlap validation.
  There are no kerb, runoff or wall layers in this asset. Unfilled space is
  **unknown coverage**, not evidence of available space or an off-track car.

To reproduce from the saved **response body only**, with no request credentials:

```sh
python3 web/scripts/generate-replay-boundaries.py \
  /path/to/F125-track-07-spline.json \
  web/src/constants/replayTrackBoundaries/7-2025.json

# Reproduce all 24 registered assets from the directory of saved bodies:
python3 web/scripts/generate-replay-boundaries.py \
  /path/to/saved-response-directory \
  web/src/constants/replayTrackBoundaries
```

The importer requires the audited source hash. A changed response or different
track needs a new source/coordinate audit before updating that pin. Request
cookies and authorization headers are never input assets or committed files.

## Source needed

Obtain a current, version-identifiable game boundary source before adding an
asset. Candidate acquisition paths are a RaceNet performance-analysis spline
export or the installed game's Monaco track markup/white-line data. An export
must contain coordinates and source/version information; authentication tokens,
cookies and account information must not be committed. RaceNet access requires
an authenticated user. Historical F1 2017 Monaco CSVs remain excluded: matching
a racing line does not prove that old road edges stayed unchanged.

Do not derive edges from an average road width, driving-line spread, or an
unverified older game/real-world map. A renderer or synthetic test passing is
not evidence that a circuit's boundaries have been verified.

## Asset contract

Add `<canonicalTrackId>-<packetFormat>.json` here after source and coordinate
review. The JSON shape is defined by `ReplayTrackBoundaries` in
`../replayTrackBoundaries.ts`:

- `schemaVersion: 1`, canonical `trackId`, exact `gameFormat` (`F1 25`/`F1 26`).
- `projection: "single-surface-xz"`: only coverage with no overlapping road
  levels in the top-down projection is supported. Exclude ambiguous overpass
  and tunnel coverage, including its features, before registering the asset.
- `provenance.description`, `gameVersion`, `verifiedAt`: actual source, game
  revision and review date. Keep source files/hashes and the verification
  method with the asset's supporting documentation.
- `maxErrorM`: verified position error bound in metres, or `null` when unknown.
  The existing corner-label tolerance of 15 m is not a boundary error bound.
- `coverage: "main-circuit"` for complete main routes; `"main-circuit-partial"`
  when audited main links are omitted. Both exclude the pit route and exterior
  surfaces. The viewer shows these limitations beside the map.
- `segments`: independently measured stretches, each with a unique `id` and
  increasing `sections[].distance`. Each section has `left` and `right` world
  `[X, Y, Z]` coordinates, or `null` for an unmeasured side. Heights are retained;
  the replay currently projects X/Z from above.
- `features`: separately verified `kerb`/`runoff` polygons and `wall` polylines,
  with world `[X, Y, Z]` points. Use an empty array if these are not measured.

Left/right follow driving direction. Pair section edges at the same measured
cross-section; do not match unrelated nearest points. Split pit branches,
separate elevations, start/finish discontinuities and unmeasured intervals into
separate segments. Use explicit null sections to break coverage. The renderer
only fills adjacent sections with both sides present and never closes the lap
or bridges separate segments automatically.

Splitting segments alone does not make overlapping elevations safe to display.
The loader rejects non-convex/zero-area road patches and patches with overlapping
X/Z interiors, including those at different heights. The source audit must also
exclude ambiguous one-sided edges and kerb/runoff/wall features, which cannot be
validated as complete road surfaces. Use additional measured sections for tight
curves; adjacent convex patches may share borders. Height-aware road selection
and numeric clearance are outside this renderer's supported scope.

The asset audit must record identity, origin/orientation/scale evidence,
available independent landmark checks, sampling limitations and coverage.
Distinguish source-backed reference geometry from verified physical accuracy. Declare known game revisions; if the source lacks
a patch identifier, explicitly mark it unknown and use the asset as a reference.
Old replays also lack patch identifiers. Matching a game family alone does not
prove identical boundaries across all historical patches; never present it as
a verified physical clearance measurement. Keep unquantified error as `null`.

The viewer loads a matching asset without reuploading old race records. It keeps
the track and recorded car positions even if a car is far outside the boundary.
Without a boundary asset it explicitly reports that the width is unavailable.
Car silhouettes remain approximate; numeric clearance and automatic fault
judgments are not provided by this layer.
