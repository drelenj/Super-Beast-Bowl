# ARCADE-2 audit (step 0)

Audit of the deployed game at the start of the sprint (commit `809bd08` on `main`), written before changing it. Verdict: **improve in place**. The architecture was sound; the engine's rule coverage and its physical model were the weak parts.

## What was there

| Area | State at audit |
|---|---|
| Architecture | TypeScript + Vite + Canvas 2D, no backend. `src/engine/` is an authoritative engine (60 Hz fixed step, seeded mulberry32 RNG, no DOM). `HumanController` (in `src/main.ts`) and `AIController` (`src/engine/ai.ts`) both produce intents; the engine resolves them. |
| Rules module | The `Engine` class itself (`src/engine/engine.ts`, about 720 lines): Hunt, tackles and Contact Scrimmage, scoring (flat and banded), Keeper Zone 5 s, Archer quotas and freeze cycle, fouls and exclusions, periods, overtime. |
| Renderer | `src/render.ts` + `src/sprites.ts`: one oblique projection, depth sort, procedural sprites. Drew the franchise logo images. No interpolation, no effects beyond a ball trail. |
| Physics | Acceleration-limited movement toward a top speed, ballistic ball with bounce, 250 m/s arrows. No mass, no body size, no stamina, no turn limit, no drag. |
| AI | Perception-limited memory per athlete (view cone, range, stale positions); role behaviours; intercept solver for receivers. |
| Ratings | **One number.** Every attribute came from OVR through a placeholder (`attrsFromOvr`). Height and build were cosmetic hashes of the Player ID. Top speed was 7.6 to 10.1 m/s. |
| Tests | Three Playwright scripts (desktop 16 checks, touch 14, catching 5) and a headless runner. No unit tests, no lint. |
| Headless seeded match | Ran to a final result in about 3 s; same seed gave the same result in one runtime. |

## What was wrong against the brief and the Rulebook

1. **Ratings and bodies.** No physical ratings, no morphology. Speed was not on the canon scale (a rating of 100 is 44.704 m/s).
2. **Defence minor.** Only "half goal / full goal at count 0" existed; the count -1 branch (owner ruling 16 Nov) was missing, and majors wrongly awarded points.
3. **Own goals.** Decided by "last touch", so a defender's deflection of a shot counted as an own goal (contradicts the 16 Nov ruling).
4. **Missed snap.** Treated as a delay-of-game minor foul on the snapper. Canon: procedural, tackle count +1 and 5 m back.
5. **Possession.** Flipped the instant a player touched the ball. Canon: after 500 ms of uncontested control.
6. **Turnover spot.** Second-tackle turnovers ignored the "own 40 m line if closer to the goal attacked" rule.
7. **After a score.** Players were not held at or behind their own 40 m lines.
8. **Out of play.** No slide to the Keeper Zone edge on a goal line, no 1.5 s ready / 4 s throw limit, no "tossed ball cannot score", no goal-line timeout ruling.
9. **Hunt.** No 6 s repeat. Two contestants per team instead of one.
10. **Illegal arrows.** Could not happen (silently refused), so they were never penalised or counted.
11. **Missing systems.** No timeouts, no substitutions (excluded or disqualified players were never replaced), no injuries, no review, no dribble rule, no 10 m rule for tackles near goal, sudden death had no periods.
12. **Scrimmage line.** Players were not kept on their own side during a snap.
13. **Breaks.** One length for all; canon has 2 / 10 / 3 / 1 minutes.
14. **Stats.** No split of points from play against penalty awards; no legal / illegal arrow count.
15. **Look.** Used logo image files (the brief now forbids them); sprites did not reflect real height or mass.

## Decision

Keep the architecture, the intent pipeline, the perception model and the screens. Rewrite the engine class in place around the same method names, add `physics.ts` (all rating-to-unit mappings in one file), import the morphology roster through a validating build script, and add unit tests. Details of what was then built are in `ARCADE2_REPORT.md`.
