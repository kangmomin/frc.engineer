# Leaderboard records

`GET /leaderboards/records` returns public timing records, full-population ordinal ranks and optional viewer metadata. `POST`, `HEAD` and other methods return `405` with `Allow: GET`.

| Query | Meaning |
| --- | --- |
| `track` | Required int32 track ID. |
| `format` | Required nonempty game format. Unknown combinations return an empty board. |
| `board` | `pb` (default), `tt` or `pace`. |
| `limit` | Integer from 1 to 200, default 50. |
| `cursor` | Optional opaque continuation, at most 1024 characters. |
| `around` | Optional public account UUID or `me`; mutually exclusive with `cursor`. |

An absent Authorization header permits anonymous access. A present invalid credential returns `401`, including expired or revoked View As credentials. `around=me` requires a resolved viewer; an explicit UUID can center a public page. The viewer and each `you` flag always identify the authenticated account, including the active View As subject, independently of the around target. Successful responses retain `Vary: Authorization` and the existing short public leaderboard cache policy. Invalid parameters or incompatible/malformed cursors return `400` plain text; storage failures return `500`, not empty records.

```json
{
  "board": "pb",
  "rows": [{
    "rank": 201,
    "accountId": "00000000-0000-4000-8000-000000000201",
    "persona": "Driver",
    "scoreMs": 90000,
    "you": false,
    "sectorsMs": [30000, 30000, 30000],
    "laps": null,
    "tyre": null,
    "consistency": null,
    "stddevMs": null,
    "withinOneSecond": null
  }],
  "total": 201,
  "leaderMs": 88000,
  "viewer": null,
  "viewerGapToTop10Ms": null,
  "nextCursor": null,
  "previousCursor": "opaque-continuation",
  "anchorFound": true,
  "asOf": "2026-09-08T01:02:03.123456Z"
}
```

`viewer` is available even when outside the returned page. `viewerGapToTop10Ms` is `max(viewer score − rank 10 score, 0)` or null if the viewer or tenth entrant is absent. Zero gap alone does not imply Top 10 membership: use `viewer.rank <= 10`.

`pb` is each account's best valid lap across all session types. `tt` additionally requires `lower(btrim(session_type)) = 'time trial'`; `TT`, unknown, Race and Practice are PB-only. All boards exclude implausible races, invalid laps and banned accounts. Best-lap representatives use lap time, upload timestamp, race UUID and lap ID in that order. PB/TT ranks then order by score, upload timestamp and account UUID. Ties receive distinct ordinal ranks.

`pace` requires at least five eligible laps per account. `scoreMs` is the average rounded to integer milliseconds, `sectorsMs` is null, and all pace fields are populated. `stddevMs` uses population standard deviation. `withinOneSecond` is a fraction from 0 to 1 whose numerator includes laps within **inclusive ±1000 ms of the displayed rounded average**. Legacy consistency remains `max(0, 1 − stddevMs / scoreMs)`. Dominant tyre is the SQL mode. These descriptive statistics currently include any valid pit or safety-car laps; there is no additional clean-lap exclusion pipeline.

Ranks, rows, count, leader, viewer and tenth-place metadata are computed in one SQL statement. Around pages include `floor(limit/2)` predecessors and clamp to the beginning/end. Missing targets return `anchorFound: false` and `rows: []` while retaining factual global/viewer metadata. Ordinary requests also have `anchorFound: false`. Completely empty boards have `rows: []`, `total: 0`, and null leader, viewer, gap and cursors.

Cursors preserve board/track/format/limit scope, direction, score/upload-time/account boundary, and an upload cutoff `asOf`. Next and previous cursors seek through full-population ranks, with previous pages returned in ascending order. First and around requests take a fresh UTC cutoff. Continuations reuse exactly the same cutoff with PostgreSQL microsecond precision; timestamps use RFC3339Nano. Upload timestamps later than the cutoff are excluded. This is **not an immutable retained snapshot**: earlier in-flight transactions that commit later, bans and deletions can affect subsequent results. Cursors do not grant authority and expose no race/session/source IDs, Steam IDs or setup data.

Compatibility: `/leaderboards/tt` still returns its existing array of **all-session PBs**; the historical name does not assert an actual Time Trial session. `/leaderboards/pace` retains its array response. Profile `timeTrial` likewise retains all-session PB semantics; non-null `racePace` adds required `stddevMs` using the same population standard deviation already calculated for that profile.

Records are client-submitted laps passing basic format, range and sector checks. Account verification reflects participation evidence, not anti-cheat or steward attestation.
