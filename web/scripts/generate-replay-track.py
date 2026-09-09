#!/usr/bin/env python3
"""Export an audited game-coordinate racing line from a local UDP capture."""

import argparse
import hashlib
import json
import math
from pathlib import Path


def packets(path):
    with path.open() as source:
        for line in source:
            yield json.loads(line)["data"]


def identity(header):
    return (header["SessionUID"], header["OverallFrameIdentifier"], header["SessionTime"])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate(capture, car, lap):
    require(car >= 0 and lap > 0, "car must be nonnegative and lap positive")
    session_identity = None
    for data in packets(capture / "session.jsonl"):
        header = data["Header"]
        current = (header["SessionUID"], header["PacketFormat"], data["TrackID"], data["TrackLength"])
        require(current[1:] == (2026, 5, 3323), "only audited Monaco / PacketFormat 2026 / 3323 m is supported")
        require(session_identity is None or current == session_identity, "mixed session identities")
        session_identity = current
    require(session_identity is not None, "missing session metadata")
    uid, packet_format, track_id, track_length = session_identity

    def validate_header(header):
        require(header["SessionUID"] == uid and header["PacketFormat"] == packet_format, "packet identity differs from session")

    selected = {}
    previous_time = previous_distance = None
    for data in packets(capture / "lap_data.jsonl"):
        header = data["Header"]
        validate_header(header)
        require(car < len(data["LapData"]), "car index outside lap data")
        entry = data["LapData"][car]
        if entry["CurrentLapNum"] != lap:
            continue
        require(entry["PitStatus"] == 0 and entry["CurrentLapInvalid"] == 0 and entry["DriverStatus"] == 4,
                "selected lap contains pit, invalid, or non-racing samples")
        distance, time = entry["LapDistance"], header["SessionTime"]
        require(math.isfinite(distance) and math.isfinite(time), "non-finite lap sample")
        require(previous_distance is None or distance > previous_distance, "lap distance must increase in capture order")
        require(previous_time is None or time > previous_time, "lap time must increase in capture order")
        key = identity(header)
        require(key not in selected, "duplicate lap frame")
        selected[key] = distance
        previous_distance, previous_time = distance, time
    require(len(selected) > 100, "insufficient lap samples")

    positions = {}
    for data in packets(capture / "motion.jsonl"):
        header = data["Header"]
        validate_header(header)
        key = identity(header)
        if key not in selected:
            continue
        require(key not in positions, "duplicate motion frame")
        require(car < len(data["CarMotionData"]), "car index outside motion data")
        entry = data["CarMotionData"][car]
        x, z = entry["WorldPositionX"], entry["WorldPositionZ"]
        require(math.isfinite(x) and math.isfinite(z), "non-finite motion position")
        positions[key] = (x, z)
    require(positions.keys() == selected.keys(), "missing exact session/frame/time motion matches")
    # Dict insertion order retains the original lap stream; sorting could hide resets.
    points = [[distance, *positions[key]] for key, distance in selected.items()]
    require(0 <= points[0][0] < 5 and abs(track_length - points[-1][0]) < 5, "lap misses the start/finish by 5 m or more")
    require(math.dist(points[0][1:], points[-1][1:]) < 10, "start/finish closure exceeds 10 m")
    for before, after in zip(points, points[1:]):
        require(after[0] - before[0] < 5 and math.dist(before[1:], after[1:]) < 5, "sample gap exceeds 5 m")

    sampled = [points[0]]
    for point in points[1:-1]:
        if point[0] - sampled[-1][0] >= 5:
            sampled.append(point)
    sampled.append(points[-1])
    return {
        "trackId": track_id,
        "gameFormat": "F1 26",
        "trackLength": track_length,
        "points": [[round(min(point[0], track_length), 3), round(point[1], 3), round(point[2], 3)] for point in sampled],
        "provenance": {
            "sourceSHA256": {name: sha256(capture / (name + ".jsonl")) for name in ("session", "motion", "lap_data")},
            "carIndex": car,
            "lapNumber": lap,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--car", type=int, required=True)
    parser.add_argument("--lap", type=int, required=True)
    args = parser.parse_args()
    try:
        result = generate(args.capture, args.car, args.lap)
    except (ValueError, KeyError, IndexError, OSError) as error:
        parser.exit(1, f"Cannot generate replay track: {error}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(f"Wrote {len(result['points'])} points to {args.output}")


if __name__ == "__main__":
    main()
