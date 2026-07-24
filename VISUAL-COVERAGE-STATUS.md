# Form Coach Visual Coverage Status

_Last updated: 24 Jul 2026, 22:08 SGT_

## Progress

- Guidance: **455 / 455 exercises** (100%)
- Visual coverage: **119 / 455 exercises** (26.2%)
- Visual frames: **238 / 910**
- Remaining: **336 exercises / 672 frames**
- Built-in routines: **20 / 20 exercises**, exactly two frames each
- Public-domain visuals: **111 exercises**
- Reviewed original diagrams: **8 exercises**

## Releases

### Release 1 — built-in routines ✅ LIVE

- Workspace commit: `089cf2f`
- Public deploy: `27042ee`
- PWA cache: `formcoach-shell-v19`
- Tests: **141 / 141 passing**
- Mobile QA: **390px viewport passes; no horizontal overflow**
- Live: https://oswaldyeo.github.io/janai-form-coach/

### Release 2 — remaining catalog 🟡 IN PROGRESS

1. **Template architecture** — ✅ complete
   - Strict positive whitelist of biomechanical archetypes
   - Equipment, view, posture, grip, pulley, and unilateral constraints
   - Explicit exceptions instead of misleading generic cards
2. **76 medium-confidence public candidates** — ✅ strict review complete
   - **32 approved; 44 rejected**
   - One apparent match was rejected at native resolution because Dumbbell Snatch used a kettlebell
   - Approved frames are staged locally: projected public+original coverage **150 / 455**; not deployed until Release 2 is complete
   - Durable ledger: `research/full-catalog/medium-review.md`
3. **Deterministic SVG engine** — ✅ first implementation complete
   - **262 exercises / 524 frames staged** across 41 archetypes
   - **187 candidates fill current text-only gaps**
   - **193 exercises remain unresolved** by the current matcher
   - 148/148 tests pass; deterministic rebuild is byte-identical
   - Three strict variant-level QA batches are running before any promotion
4. **Generate staged two-frame visuals** — 🟡 first staging pass underway
5. **Human/visual QA by archetype** — ⏳ pending staged assets
6. **Integrate provenance + offline behavior** — ⏳ pending QA
7. **Full test/mobile/PWA gates** — ⏳ pending integration
8. **Commit, deploy, verify 455/455** — ⏳ pending all gates

## Release gates

- Every exercise has exactly two accurate frames
- No misleading equipment, grip, movement-plane, or exercise variants
- Every visual has source/provenance
- Existing verified assets remain offline-ready
- Missing/invalid individual assets cannot abort the build
- All tests pass
- No horizontal overflow at 390px
- Live Pages and service-worker version verified after deployment

## Log

- **21:30** — Release 1 deployed and verified live.
- **21:34** — Full-catalog visual architecture completed.
- **21:34** — Medium-confidence candidate review started.
- **21:34** — Deterministic visual-engine implementation started.
- **21:44** — Status tracker created.
- **21:54** — First engine snapshot: 262 exercises / 524 frames staged across 41 archetypes; 193 remain unresolved. No staged assets promoted yet.
- **21:55** — Public-candidate review completed: 33 candidate promotions, 43 rejects. Final strict equipment/variant gate remains before merge.
- **22:00** — Engine first pass completed: 262 staged, including 187 current gaps; 193 declined.
- **22:04** — Caught and fixed a pre-existing mismatched Glute Bridge visual (loaded barbell demo on the bodyweight exercise). Replaced with reviewed bodyweight frames; deployed as public commit `ce179e7`, PWA cache `v20`, and verified live/offline-ready.
- **22:04** — Strict QA split across all 262 staged mappings; promotion remains blocked until exact equipment/posture/grip/plane variants pass.
- **22:08** — Medium library gate finalized: 32 approved, 44 rejected. Native inspection caught and rejected Kettlebell Snatch for Dumbbell Snatch. Approved public visuals stage local coverage at 150/455; no Release 2 deployment yet.
