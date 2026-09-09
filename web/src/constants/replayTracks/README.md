# Audited replay track references

The only supported static reference is **Monaco (canonical track ID 5), F1 26
(UDP PacketFormat 2026), 3323 m**. `5-2026.json` contains `[lapDistance, worldX,
worldZ]` points from a complete, valid racing lap. This is a captured racing
line, not a surveyed track centreline or track boundary.

The original capture reports GameYear 25 alongside PacketFormat 2026. This is
not evidence of compatibility with F1 25; use this asset only for F1 26.
JSONL session IDs are already parsed by the capture writer; do not apply the
wire-to-canonical mapping again. Monaco is ID 5 in both mappings, independently
confirmed from the original raw session packet.

To reproduce from the locally retained `test-sets/race-clean-start` capture
dated 2026-06-23, run from the repository root:

```sh
python3 web/scripts/generate-replay-track.py "$CAPTURE_DIRECTORY" \
  web/src/constants/replayTracks/5-2026.json --car 21 --lap 2
```

The generator validates one session and the audited track/format/length,
strictly increasing lap distance and time, normal racing with no pit or invalid
samples, exact session/frame/time motion matches, full start/finish coverage,
and coordinate continuity. It rejects other track/format combinations until
independently audited. It keeps points approximately every 5 m plus both
endpoints, rounded to three decimal places. Source SHA-256 hashes, car index,
and lap number identify the extraction without publishing driver names, session
UIDs, or local paths.

The source lap has 4499 points, distance 0.7636719–3323.0605 m, a 1.71045 m
start/finish gap, and a maximum source coordinate step of 1.26051 m. The slight
finish-distance overflow (0.0605 m) is clamped to the session track length in
the export, preserving the measured endpoint coordinates. The generator
accepts less than 5 m of finish-distance discrepancy; all exported distances
are bounded by the session track length.
Corner labels that reuse canonical lap fractions are approximate locations
along this racing line, not independently surveyed game corner coordinates.

The viewer keeps a usable captured outline first. A reference must match both
the canonical track ID and game format. Car distance never hides the reference;
measured car positions are never snapped or removed. Captured-outline corner
labels require both paths to be within 15 m of one another, allowing sampling
and racing-line variation. Missing or failed reference loads leave local replay usable.

Other historical replays need a valid captured outline or another independently
audited reference. The repository's recorded CSV filenames alone do not prove
track identity or game version: current Monza is mock geometry, older Monza
has an incompatible lap length, several files contain distance regressions,
and unknown recordings lack identity metadata. None is a static fallback here.
