# Technical ratings: ARCADE-DERIVED, NOT CANON (tech-1.0)

**Status: ARCADE-DERIVED, NOT CANON (tech-1.0).** The 19 technical ratings are invented for this arcade game by a
deterministic generator. They are not part of the Beastball canon workbook. They appear only in the in-game player
details view and in the exported `data/tech_ratings.json`. The canon Opening-day OVR and the nine locked physical
ratings are read by the generator and are never modified.

- Generator: `src/ratings/tech.ts` (`techRatings`, `techComposite`, `ROLE_SKILLS`, `TECH_KEYS`, `TECH_VERSION`)
- Build script: `scripts/build_tech.ts`
- Output: `data/tech_ratings.json`, `docs/TECH_POPULATION_REPORT.md`
- Tests: `tests/unit/tech.test.ts`, `tests/unit/roster.test.ts`

## What is and is not used

| Used | How |
|---|---|
| Player ID | Seed for the noise only |
| Position | Selects the role table row |
| Opening-day OVR (canon) | The centre of every skill |
| Nine locked physical ratings (canon) | Small centred contribution to 7 of the 19 skills |

**Not used at all:** height, mass, arm span, reach, physique, ancestry, age, experience, salary, camp score, role,
team. Owner rule: no size bonuses on top of ratings. A test changes every size field and requires identical output.

## The 19 skills

tackling, ballSecurity, catching, passAccuracy, passVision, shotAccuracy, carryPower, elusiveness, pursuit, coverage,
screening, archeryAim, archeryDiscipline, keeperReaction, keeperPositioning, footwork, discipline, clutch, awareness.
All are integers from 60 to 99.

## Formula

For player `p` and skill `key`:

```
v      = roleCentre(pos, key, OVR) + noise(id, key) + phys(key)
v      = v > 92 ? 92 + 0.6 * (v - 92) : v            (soft ceiling)
rating = round(v)
rating = min(rating, OVR)                            (off-role skills only)
rating = clamp(rating, 60, 99)
```

### Role centre

| Tier | Centre | Meaning |
|---|---|---|
| primary | OVR + 3 | The position's 3 defining skills |
| secondary | OVR - 2 | The position's 4 supporting skills |
| general | OVR - 1 | footwork, discipline, clutch, awareness, when the role table does not already list them |
| off-role | 60 + 0.6 * (OVR - 60) | Everything else, discounted toward the floor of 60, and never above OVR |

Off-role examples: OVR 70 gives centre 66, OVR 80 gives 72, OVR 90 gives 78, OVR 99 gives 83.4. So a Striker has
high shotAccuracy and modest keeperReaction.

### Role table (`ROLE_SKILLS`)

Position labels are arcade placeholders. Every position has exactly 3 primary and 4 secondary skills, so the
composite has the same expected offset from OVR at every position and team strength is not biased by formation.

| Pos | Arcade role | Primary (OVR + 3) | Secondary (OVR - 2) |
|---|---|---|---|
| STR | Striker, finisher | shotAccuracy, elusiveness, catching | ballSecurity, footwork, clutch, passAccuracy |
| SCT | Scout, wide receiver | catching, elusiveness, footwork | ballSecurity, shotAccuracy, passAccuracy, awareness |
| SEN | Sentinel, screener | screening, tackling, awareness | carryPower, coverage, ballSecurity, discipline |
| TRK | Tracker, pursuer | pursuit, tackling, footwork | coverage, awareness, catching, discipline |
| HNT | Hunter, ball hawk | pursuit, coverage, catching | tackling, awareness, elusiveness, footwork |
| TRP | Trapper, interceptor | coverage, catching, awareness | pursuit, tackling, footwork, passAccuracy |
| GRD | Guard, goal-side defender | tackling, coverage, discipline | screening, pursuit, awareness, ballSecurity |
| PDR | Playdriver, passer | passAccuracy, passVision, awareness | ballSecurity, clutch, footwork, shotAccuracy |
| PFD | Power forward, carrier | carryPower, ballSecurity, shotAccuracy | catching, screening, elusiveness, clutch |
| KPR | Keeper | keeperReaction, keeperPositioning, catching | awareness, footwork, passAccuracy, discipline |
| ARC | Archer | archeryAim, archeryDiscipline, awareness | discipline, clutch, footwork, passVision |

General skills (footwork, discipline, clutch, awareness) not listed in a row sit at OVR - 1. All other skills are
off-role for that position.

### Physical contribution (`PHYS_COEF`)

`phys(key) = clamp( sum of k * (rating - 80), -3, +3 )`. Physical ratings are 65 to 100, so each term is centred
and small. These are every coefficient in the generator:

| Skill | Coefficients | Range of contribution |
|---|---|---|
| tackling | 0.08 strength, 0.06 balance | -2.1 to +2.8 |
| carryPower | 0.09 strength, 0.06 balance | -2.25 to +3.0 |
| elusiveness | 0.08 agility, 0.06 acceleration | -2.1 to +2.8 |
| pursuit | 0.08 speed, 0.06 acceleration | -2.1 to +2.8 |
| keeperReaction | 0.08 agility, 0.06 jumping | -2.1 to +2.8 |
| screening | 0.10 strength | -1.5 to +2.0 |
| footwork | 0.07 agility, 0.07 balance | -2.1 to +2.8 |

Pure-skill keys get **nothing** physical: passAccuracy, passVision, shotAccuracy, archeryAim, archeryDiscipline,
discipline, clutch, awareness, ballSecurity, catching, coverage, keeperPositioning. The physical ratings throwPower,
stamina and durability are not used by any skill. The physical ratings themselves drive the engine's motor model
directly (see `src/engine/physics.ts`); the technical ratings only add this small cross-term.

### Noise model

- One independent draw per (player, skill).
- Standard normal by Irwin-Hall: sum of 12 uniforms minus 6 (mean 0, SD 1).
- Truncated at +/- 2 SD by rejection (re-draw up to 16 times from the same stream, then clamp).
- Scaled by SD 4 rating points, so the noise is always within +/- 8. Realised SD after truncation is about 3.55.

Irwin-Hall is used instead of Box-Muller on purpose: it needs only exact additions. Box-Muller needs `Math.log` and
`Math.cos`, whose last bit is allowed to differ between JavaScript engines, which could flip a rounding in one
browser. The generator uses only integer arithmetic, `Math.imul`, `Math.round` and the IEEE-754 basic operations,
so Node and every browser give identical output. It uses no `Math.random` and no `Date`.

### Seed derivation

```
seed     = FNV-1a 32-bit ( id + '|' + 'tech-1.0' + '|' + key )     over UTF-16 code units
uniforms = mulberry32(seed)                                        32-bit resolution, in [0, 1)
```

Changing `TECH_VERSION` reseeds every player. The same Player ID always gives the same ratings for a given version.

### Soft ceiling

The part of a value above 92 is multiplied by 0.6 before rounding. Without it, an OVR 97+ player would have most
primary skills pinned at 99. With it, only 3 of 13,528 values are at 99 and elite players still differ from each
other. It is monotonic, so it never reorders two players on the same skill centre.

## Composite

`techComposite(p)` = weighted mean of the position's 3 primary skills (weight 2 each) and 4 secondary skills
(weight 1 each), rounded to 2 decimals. Expected value is about OVR + 1 at every position. It is used for team
strength checks and the population report only; the engine does not read it.

## How to regenerate

```
npm run build:tech        # = npx tsx scripts/build_tech.ts
npm test                  # = npx vitest run
```

The build reads `data/rosters.json` and rewrites `data/tech_ratings.json` and `docs/TECH_POPULATION_REPORT.md`.
There are no timestamps, so a re-run on the same roster produces byte-identical files. A test fails if the
committed JSON differs from a fresh generation. `data/rosters.json` is never written.

`data/tech_ratings.json` shape:

```
{ version: 'tech-1.0', label: 'ARCADE-DERIVED, NOT CANON', generatedFrom, generator, note, keys: [19 keys], count: 712,
  players: { [id]: { name, franchise, pos, ovr, tech: { ...19 integers }, composite } } }
```

## Realised numbers (712 players, 26 teams)

From `tests/unit/tech.test.ts` and `docs/TECH_POPULATION_REPORT.md`:

| Check | Requirement | Realised |
|---|---|---|
| Values | integers 60-99, 19 keys, 712 players | pass |
| corr(composite, OVR), all players | > 0.9 | 0.970 |
| corr(composite, OVR), per position | > 0.9 | 0.946 (SEN) to 0.977 (STR, TRK) |
| Largest abs corr(composite, one physical rating) | below the OVR correlation | 0.058 (stamina) |
| Team strength Spearman (mean composite vs mean OVR of the 12 starters) | >= 0.9 | 0.998 |
| Same-OVR same-position pairs differing in >= 3 skills | >= 90% | 875 of 875 (100%), mean 17.5 of 19 skills differ |
| Noise | SD between 3.0 and 4.2, within +/- 8 | mean -0.010, SD 3.554, min -8.00, max 7.99 |
| One physical rating swung 65 to 100 | moves any skill by <= 4 | largest move 4 |
| Size fields changed | output identical | identical |
| Mean (skill - OVR) by tier | primary > secondary > off-role | primary +2.94, secondary -1.97, general -0.96, off-role -7.40 |

The only team-order differences against starter OVR are swaps between adjacent teams whose mean starter OVR is
within 0.5 of each other (see section 7 of the population report).

## Limits

- The role table, tier offsets, physical coefficients and noise SD are arcade design choices, not canon.
- Off-role skills of low-OVR players sit in a narrow window between 60 and OVR, so they vary less than other skills.
- The engine currently reads passAccuracy, shotAccuracy, catching, tackling, ballSecurity, awareness, archeryAim,
  archeryDiscipline and discipline (`attrsFor` in `src/engine/physics.ts`). The other skills are shown in the
  details view and exported, but do not yet affect play.
