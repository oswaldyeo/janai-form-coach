#!/usr/bin/env python3
"""Generate the offline Form Coach catalogue module from a Hevy template JSON array.

Input is the combined `exercise_templates` array returned by Hevy's paginated
GET /v1/exercise_templates endpoint. Custom/private templates are excluded.
The output is deterministic: title + Hevy id sort, stable ids, compact JSON.

Usage:
  python3 scripts/generate-hevy-catalog.py templates.json
"""

import argparse
import json
from pathlib import Path

PUSH = {"chest", "shoulders", "triceps"}
PULL = {"biceps", "forearms", "lats", "lower_back", "traps", "upper_back"}
LEGS = {"abductors", "adductors", "calves", "glutes", "hamstrings", "quadriceps"}
WEIGHTED = {"weight_reps", "bodyweight_weighted", "bodyweight_assisted", "short_distance_weight"}


def category(muscle: str) -> str:
    if muscle in PUSH:
        return "push"
    if muscle in PULL:
        return "pull"
    if muscle in LEGS:
        return "legs"
    if muscle == "abdominals":
        return "core"
    if muscle == "cardio":
        return "cardio"
    return "other"


def normalize(template: dict) -> dict:
    tracking = template["type"]
    equipment = template["equipment"]
    return {
        "id": f"hevy-{template['id'].lower()}",
        "hevyId": template["id"],
        "name": template["title"],
        "category": category(template["primary_muscle_group"]),
        "equipment": equipment,
        "primaryMuscle": template["primary_muscle_group"],
        "secondaryMuscles": template.get("secondary_muscle_groups") or [],
        "loadType": "external" if tracking in WEIGHTED or equipment != "none" else "bodyweight",
        "trackingType": tracking,
        "unilateral": False,
        "defaultRestSec": 90,
        "camera": None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="JSON array of Hevy exercise templates")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "js/engine/hevy-catalog.js",
    )
    args = parser.parse_args()

    raw = json.loads(args.input.read_text())
    if not isinstance(raw, list):
        raise SystemExit("input must be a JSON array")
    official = [t for t in raw if not t.get("is_custom")]
    rows = [normalize(t) for t in sorted(official, key=lambda t: (t["title"].casefold(), t["id"]))]
    if len({r["id"] for r in rows}) != len(rows):
        raise SystemExit("duplicate Hevy ids")

    header = (
        "// Generated from the Hevy API exercise-template catalogue. Do not hand-edit.\n"
        "// Snapshot: 2026-07-22 · standard templates only; no private custom exercises.\n\n"
    )
    args.output.write_text(
        header + "export const HEVY_CATALOG = " + json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    print(f"wrote {args.output}: {len(rows)} official templates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
