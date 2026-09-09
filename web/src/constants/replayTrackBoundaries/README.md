# Replay road boundaries

No production boundary asset is registered yet. The existing Monaco F1 26
reference is a racing line and provides no road width. Historical F1 2017
Monaco boundary CSVs were located during source discovery and deliberately
excluded: matching a racing line does not prove that road edges stayed unchanged.

## Source needed

Obtain a current, version-identifiable game boundary source before adding an
asset. Candidate acquisition paths are a RaceNet performance-analysis spline
export or the installed game's Monaco track markup/white-line data. An export
must contain coordinates and source/version information; authentication tokens,
cookies and account information must not be committed. RaceNet access currently
requires an authenticated user; no current spline response was available here.

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

The asset audit must verify identity, origin/orientation/scale, alignment at
multiple independent landmarks, straight and corner edge placement, geometry
sampling error and coverage. Declare the game revisions for which compatibility
is supported. Old replays lack patch identifiers: register an asset under a game
format only if its compatibility covers that format's supported captures.

The viewer loads a matching asset without reuploading old race records. It keeps
the track and recorded car positions even if a car is far outside the boundary.
Without a boundary asset it explicitly reports that the width is unavailable.
Car silhouettes remain approximate; numeric clearance and automatic fault
judgments are not provided by this layer.
