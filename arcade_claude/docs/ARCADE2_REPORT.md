# ARCADE-2 report (Super Beast Bowl)

Branch `fable/arcade-2`, merged to `main` for GitHub Pages. This is a separate TypeScript arcade implementation of Rulebook 1.0. **Arcade results are not simulator evidence.** Status words are used strictly: IMPLEMENTED = code exists; TESTED = an automated test or browser run passed here; only the owner ACCEPTS.

## Owner briefing

1. **Accomplished.** The roster with heights, mass, reach and the nine locked physical ratings is imported by a validating build script. The engine was rebuilt around Rulebook 1.0 and the 16 Nov rulings, with ratings-driven physics. Derived technical ratings (tech-1.0), a new look with size-scaled sprites, a new HUD and screens, and 150 unit tests were added. Kamasi Sinella uses the final canonical profile supplied on 16 Nov.
2. **What the game can do now.** Play vs AI, Watch AI vs AI and Local 2P on the real 26 rosters; athletes move, collide, tire, jump and throw from their own ratings and body size; the match follows the Rulebook flow (Hunt, tackles, scrimmages, toss-ins, timeouts, substitutions, injuries, review, overtime and sudden death); every whistle is explained on screen; rosters and player details (locked physical ratings, arcade-derived technical ratings) can be browsed and exported.
3. **Unimplemented or unproven.** See "Not done" below. The main ones: no instant replay, audio is basic, the older touch and desktop Playwright scripts were not brought back to passing, 60 fps on a mid-range phone is not shown, several Rulebook items are not modelled (listed in `RULE_MATRIX.md`), and match rhythm is still very stop-start.
4. **Blocking.** Nothing blocks play. Sixteen canon questions need rulings (`ARCADE2_CANON_QUESTIONS.md`); each has a provisional default in code.
5. **Recommended action.** Play a match on the live site, then rule on the canon questions, starting with Keeper reach, the restart after a half goal, and the goal-line toss timeout.

## Evidence

### Tests (run on the final tree)
- `npm test`: **150 / 150 pass** (rules 115, physics 16, tech ratings 13, roster 6).
- `npm run smoke` (headless Chromium, desktop and phone profile): **all checks pass**, no console errors; screenshots in `docs/screens/`.
- `npm run typecheck` clean; `npm run lint` 0 errors.
- Seeded replay: same seed gives the same event hash and final state; a different seed differs (in `physics.test.ts` and `rules.test.ts`).
- Not passing / not re-run: `tests/touch_check.cjs` did not complete against the new engine (8 checks passed, then it stalled in a gameplay-dependent loop); `tests/browser_check.cjs` and `tests/catch_check.cjs` were not re-run.

### 20 seeded AI-vs-AI matches (`npm run stats`, canon clock, flat scoring, Pro)
Full table in `STATS_20.md`.

| Measure | Value |
|---|---|
| Completed | 20 / 20 (none went to overtime) |
| Points per match, both teams | 50.8 |
| Points from play | **95.8%** |
| Points from penalty awards | 4.2% |
| Arrows legal / illegal | 8,734 / 48 (**0.55% illegal**) |
| Per match | goals 23.6, shots 110, pass completion 84%, tackles 408, interceptions 177, Keeper saves 66, freezes 119, minors 4.2, majors 0, DQs 0.05, turnovers 138, timeouts 5.0, substitutions 2.4, injuries 1.5, reviews 0.35, toss-ins 120 |

The simulator's two problems named in the brief (about two thirds of arrows illegal, about 78% of points from penalty awards) do not occur here. That says the arcade Archer AI respects the legal-target rule; it says nothing about the simulator.

### Performance
- Simulation step: 0.07 ms mean on this machine (`npm run bench`), under 3% of a 60 fps frame even at an assumed 5x phone slowdown.
- Browser frame rate (`tests/bench_phone.cjs`, 844x390 at DPR 3, software rendering): 60 fps unthrottled; **21 fps with 4x CPU throttling**. So 60 fps on a mid-range phone is **not demonstrated**; a real device test is needed.
- Build: 656 KB total in `dist/`, no image assets shipped.

### What changed, by workstream
1. **Rules.** See `RULE_MATRIX.md` (115 tested rows, plus the list of rules not modelled) and the audit's list of faults, all fixed except those named under "Not done".
2. **Technical ratings.** `docs/TECH_RATINGS.md`, `TECH_POPULATION_REPORT.md`. Correlation of composite with OVR 0.97; team order Spearman 0.998; size has no effect; labelled ARCADE-DERIVED, NOT CANON in the details view and the export. The engine uses 9 of the 19 skills; the other 10 are display-only so far.
3. **Physics.** `src/engine/physics.ts` holds every mapping. Speed = rating / 100 x 44.704 m/s (one constant). Acceleration, turn rate, jump, throw speed, stamina and injury chance each come from one rating through one function. Body radius from height and mass; collisions conserve momentum; ball has gravity, light drag and bounce; arrows fly straight at 250 m/s.
4. **Look.** Sprites scaled by real height and mass with physique silhouettes, team-colour kits, status rings and icons, Archer platform and aim cone, stadium, effects, title backdrop. Logo images are no longer drawn or shipped; colour crests replace them.
5. **UI.** Referee banner, play-clock ring with tackle count, Archer HUD with legal-target state, pass and possession callouts, difficulty (reaction time and decision noise only), mute, timeout button, intro card, tutorial, roster and player details, stat cards with the play-vs-awards panel.
6. **AI.** Archer legal-target constraint and quota sense, stamina-aware sprinting, coach timeouts, substitutions, difficulty levels.
7. **Tooling and docs.** vitest, eslint, smoke run, benchmarks, this report, the audit, the matrix, the canon questions.

### Roster data notes
- 712 unique IDs, 26 franchises, ratings integers 65 to 100, all heights present (`npm run build:roster` fails loudly otherwise).
- **Kamasi Sinella**: the workbook row did not match the brief's "every rating 85+". The owner then supplied the final profile (OVR 98, 1,018 lb, wingspan 10'7.7", reach 12'6.9", Rangy, Ly'Kun / Shynän / Dryqona, ratings 91 to 97). It is applied through `data/roster_overrides.json`; the workbook itself is untouched. His "primary / secondary attribute" text still comes from the workbook row.
- The workbook is not committed (it sits in the git-ignored `.scratch/`); the generated JSON is.

## Not done
- Instant replay of goals; richer audio (a small procedural set exists; music is absent).
- Rulebook items not modelled: Hunt false start and "not set", held ball, offside as a penalty, delay-of-game warning, head contact, off-ball and after-whistle majors, boundary and Keeper-immunity reviews. No majors occurred in the 20 matches, so the major-foul path is tested only by unit tests.
- Dribble has a rule but no control: it only happens by accident.
- Touch controls drive the home team only; Local 2P needs keyboard or gamepad.
- Match rhythm: about 408 tackles and 120 toss-ins per match makes play stop-start. Team balance still follows OVR heavily.
- The parallel work was cut off twice by a usage limit, so the look and UI passes are shorter than planned and were verified by the smoke run and screenshots, not by a full manual review.

## What to do next, by value
1. Rule on the canon questions (Keeper reach, restart after a half goal, goal-line toss timeout first).
2. Test on a real iPhone for frame rate and control feel; reduce DPR or effects if it is below 60 fps.
3. Tune match rhythm (fewer tackles and toss-ins) and add a dribble control.
4. Model the missing fouls (off-ball, after the whistle, offside) so majors and DQs appear in play.
5. Bring the older Playwright scripts back or retire them in favour of the smoke run.
6. Instant replay and music.
