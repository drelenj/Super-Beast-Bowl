# SUPER BEAST BOWL 2 (Beastball arcade, Claude Code build)

Browser-playable 2.5D arcade Beastball: two teams of 12, a ball thrown or carried into a semicircular
goal, a Keeper and an Archer per team (arrows freeze opponents), 4 periods, a 30 s play clock and
two-tackle possessions. TypeScript + Vite + Canvas 2D, no backend, no paid assets, no third-party marks.
Phones (touch), keyboard and gamepad are supported.

**Disclaimer.** This is a separate TypeScript arcade implementation of the canon (Rulebook 1.0), not the
Python simulator. Arcade results are not simulator evidence. Physical ratings are the LOCKED canon values;
the 19 technical ratings are **ARCADE-DERIVED, NOT CANON** (tech-1.0). Team crests are original colour
glyphs generated in code (`src/ui/crest.ts`); no logo image files are used by the game.

## Commands

```
cd arcade_claude
npm install
npm run dev            # dev server, http://localhost:5173
npm run build          # type-check + static build in dist/ (GitHub Pages)
npm run preview        # serve dist/ on :4173
npm run build:roster   # rebuild data/rosters.json from the canon workbook export
npm run build:tech     # regenerate the ARCADE-DERIVED tech ratings (tech-1.0)
npm test               # unit tests (vitest)
npm run smoke          # headless browser smoke test (server must be running; see below)
npm run stats          # multi-match headless statistics
npm run bench          # engine benchmark
```

Smoke test and browser checks (Playwright, headless Chromium; start `npm run dev` first):

```
BASE=http://localhost:5173/ SHOTS=docs/screens node tests/smoke.cjs   # menu, rosters, match, halftime, final, phone
BASE=http://localhost:5173/ node tests/browser_check.cjs              # keyboard acceptance + determinism
BASE=http://localhost:5173/ node tests/touch_check.cjs                # emulated phone, multi-touch
BASE=http://localhost:5173/ node tests/catch_check.cjs                # pass / receiver take-over / catch assist
```

URL helpers for automated runs: `?auto=ava|hva|hvh&home=..&away=..&seed=..&speed=..&period=60&difficulty=rookie|pro|legend&scoring=banded&autobreak=1&touch=1`
(`auto` skips the intro card and the tutorial; add `&intro=1` to see the intro card).

## Playing

Menu: Play (Human vs AI), Watch (AI vs AI), Local (Human vs Human), Rosters and ratings, How to play, Controls, mute.
Team select: 26 franchises, HOME / AWAY picker, mode, **difficulty** (Rookie / Pro / Legend: changes AI reaction
time and decision noise only, never any rating), scoring (flat / provisional banded), clock (canon 4 x 600 s,
4 x 120 s, 4 x 60 s) and seed.

| Action | Player 1 | Player 2 (HvH) | Gamepad | Touch |
| --- | --- | --- | --- | --- |
| Move | W A S D / arrows | Arrows | Left stick / D-pad | Left-thumb floating stick |
| Sprint | Shift | Right Ctrl | RB / RT | Outer ring of the stick, or SPRINT |
| Pass / release the snap | Space | Enter | A | PASS |
| Tackle | J | . | B | TACKLE |
| Switch athlete | K | , | Y | SWITCH |
| Shoot at goal | L | / | X | SHOOT |
| Archer (auto-aim, legal targets only) | E | ' | LB | ARCHER (dims when no legal target or no quota) |
| Timeout | T | \ | Back / Select | T.O. |
| Pause / mute | Esc / M | Esc | Start | II / speaker |

Spectator: `1 2 3 4` speed (1x / 2x / 4x / 8x), `C` camera, `N` next athlete.

HUD: score bug with crests, period clock, play-clock ring (30 s, red under 8 s, shows the 10 s snap countdown),
tackle pips, referee banner for every whistle (what, who, penalty), pass-in-flight and possession callouts,
Archer panel for human teams (arrows of 15, freezes of 5, TARGET IN ZONE / NO LEGAL TARGET).
Break and final screens show team stats, the match-stats panel (points from play vs penalty awards, arrows
legal / illegal, minors, majors, DQs, turnovers, timeouts, substitutions, injuries, reviews) and top performers.
Rosters: every registered player with morphology, the nine locked physical ratings and the arcade-derived
technical ratings; "Export tech ratings JSON" downloads all 712 players (label and version inside the file).

## Layout

* `src/engine/` authoritative engine (fixed 60 Hz steps, seeded RNG, no rendering), AI controller, rules.
* `src/ratings/tech.ts` ARCADE-DERIVED technical ratings (tech-1.0).
* `src/render.ts`, `src/sprites.ts`, `src/gfx/` renderer and procedural athlete sprites; `src/audio.ts` procedural audio.
* `src/main.ts` screens, HUD, HumanController (keyboard / gamepad / touch), spectator controls.
* `src/touch.ts` touch joystick and buttons. `src/ui/` crests, roster and player cards, stat cards, tutorial.
* `data/rosters.json`, `data/team_colors.json` exported from the canon workbook.
* `tests/` smoke and browser checks; `docs/screens/` smoke screenshots.
