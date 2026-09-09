#!/usr/bin/env python3
"""Export audited F125 RaceNet response bodies as replay road references."""

import argparse
import hashlib
import json
import math
from pathlib import Path


MANIFEST = json.loads(Path(__file__).with_name("replay-boundary-sources.json").read_text())


def generate(raw):
    digest = hashlib.sha256(raw).hexdigest()
    source = next((s for s in MANIFEST["sources"] if s["sha256"] == digest), None)
    if source is None:
        raise ValueError("source is not an audited F125 snapshot")
    track = json.loads(raw)["track"]
    gates = {gate["id"]: gate for gate in track["gates"]["gate"]}
    links = {link["id"]: link for link in track["links"]["link"]}
    route = next(route for route in track["routes"]["route"] if route["type"] == "track")
    ordered = [links[index] for index in range(route["from_link"], route["to_link"] + 1)]
    gate_ids = [ordered[0]["from_gate"]]
    for link in ordered:
        if gate_ids[-1] != link["from_gate"]:
            raise ValueError("disconnected main route")
        gate_ids.append(link["to_gate"])
    if gate_ids[0] != gate_ids[-1]:
        raise ValueError("main route has no explicit closing link")

    sections = []
    distance = 0
    previous = None
    for gate_id in gate_ids:
        gate = gates[gate_id]
        position = [gate["position"][axis] for axis in ("x", "y", "z")]
        if previous is not None:
            distance += math.dist(previous, position)
        section = {"distance": round(distance, 6)}
        waypoints = {waypoint["type"]: waypoint["length"] for waypoint in gate["waypoints"]["waypoint"]}
        for side in ("left", "right"):
            offset = waypoints[side + "_white_line"]
            # RaceNet's gate helper uses the full signed normal, including Y.
            # These samples are joined linearly; no extra accuracy is implied.
            section[side] = [round(gate["position"][axis] + offset * gate["normal"][axis], 6) for axis in ("x", "y", "z")]
        sections.append(section)
        previous = position

    # Only continuous runs of audited links form surfaces. In particular, do
    # not bridge omitted overpasses or repair malformed source normals.
    segments = []
    run = []
    for index, link in enumerate(ordered):
        if link["id"] in source["excludedLinks"]:
            if run:
                segments.append({"id": f"main-{len(segments)}", "sections": run})
                run = []
            continue
        if not run:
            run = [sections[index]]
        run.append(sections[index + 1])
    if run:
        segments.append({"id": f"main-{len(segments)}", "sections": run})
    if not source["excludedLinks"]:
        segments[0]["id"] = "main"

    return {
        "schemaVersion": 1,
        "projection": "single-surface-xz",
        "trackId": source["trackId"],
        "gameFormat": "F1 25",
        "coverage": "main-circuit-partial" if source["excludedLinks"] else "main-circuit",
        "provenance": {
            "description": f"EA RaceNet · {source['name']} · 본선 흰선",
            "gameVersion": "F1 25 · 게임 패치 미확인",
            "verifiedAt": MANIFEST["verifiedAt"],
            "sourceUrl": f"https://web-api.racenet.com/api/F125Stats/performanceAnalysis/spline?trackId={source['apiTrackId']:02d}",
            "sourceSHA256": digest,
            "interpolation": "linear-between-source-gates",
        },
        "maxErrorM": None,
        "segments": segments,
        "features": [],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Response body or directory of F125-track-XX-spline.json bodies, without request headers")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.source.is_dir():
            results = [generate((args.source / f"F125-track-{s['apiTrackId']:02d}-spline.json").read_bytes()) for s in MANIFEST["sources"]]
            outputs = [(args.output / f"{result['trackId']}-2025.json", result) for result in results]
        else:
            outputs = [(args.output, generate(args.source.read_bytes()))]
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"Cannot generate road boundaries: {error}\n")
    for output, result in outputs:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
