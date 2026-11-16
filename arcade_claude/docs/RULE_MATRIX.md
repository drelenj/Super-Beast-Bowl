# Rule matrix (Rulebook 1.0 against the arcade engine)

**TESTED** means an automated test in `tests/unit/rules.test.ts` passes against this arcade engine (`npm test`). It is not simulator evidence and not owner acceptance. Rulebook tags: the 14 Nov ratification made every PROPOSED item canon; scoring values stay PROVISIONAL; "OWNER RULING 16 Nov" marks the three rulings in the ARCADE-2 brief. Arcade defaults for open points are in `ARCADE2_CANON_QUESTIONS.md`.

115 automated rule tests, all passing at the time of writing.

| Area | Rule as tested (test name) | Tag | Code location | Status |
|---|---|---|---|---|
| match structure | match: 4 periods of 600 s, overtime 300 s, play clock 30 s (constants and default settings) | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | match: a period ends when the game clock reaches 0 (period_end event, break, next period at 600 s) | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | match: ends are exchanged at every break (teams[].dir flips in resumeFromBreak) | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | match: not tied after period 4 ends the match with the leader as winner | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | overtime: tied after period 4 gives period 5 of 300 s (settings.otLen) | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | overtime: a lead at the end of period 5 ends the match; still tied goes to sudden death (period 6) | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | sudden death: a goal ends the match | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | sudden death: a half goal ends the match | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| match structure | sudden death: a full-goal award (defence minor at count 0) ends the match | CANON | `engine.ts: rules, endPeriod, resumeFromBreak, award` | TESTED |
| First Hunt | hunt: a First Hunt opens the match (phase set, huntActive, restart.kind hunt, ball at the centre) | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: a First Hunt opens every period, overtime and sudden death | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: every field player starts at or behind his own 40 m line | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: repeats if the ball has not left the centre circle after 6 s | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: the Hunt ends when the whole ball has left the 5 m centre circle | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: Archers cannot fire before the ball leaves the circle (fireArrow is a no-op, arrowLegal false) | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| First Hunt | hunt: over the opening of real matches no arrow event precedes the ball leaving the circle | CANON | `engine.ts: setupHunt, rules, fireArrow` | TESTED |
| play clock | play clock: expiry is a turnover scrimmaged at the spot when the spot is beyond the new team's own 40 m line | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| play clock | play clock: expiry behind the new team's own 40 m line is scrimmaged at that 40 m line (closer to the goal it attacks) | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| play clock | play clock: counts down in live play and does not run during the Hunt | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| play clock | play clock: carries through a first tackle (not reset by the Contact Scrimmage) | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| play clock | play clock: fresh 30 s after a score | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| play clock | play clock: fresh 30 s after a turnover | CANON | `engine.ts: rules, changePossession, turnover` | TESTED |
| field constants | field: goal radius 3 m, Keeper Zone 20 m, centre circle 5 m, 40 m scrimmage lines, 100 m x 100 m | CANON | `constants.ts, physics.ts: PHYS` | TESTED |
| field constants | field: Archer platform is 5 m high and 5 m back (constants and the Archer's actual position) | CANON | `constants.ts, physics.ts: PHYS` | TESTED |
| field constants | field: arrow speed 250 m/s (constants, the arrow's velocity and its time of flight) | CANON | `constants.ts, physics.ts: PHYS` | TESTED |
| goal: whole ball inside the semicircle | goal: ball radius is PHYS.BALL_R = 0.11 m and the goal is a 3 m semicircle | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| goal: whole ball inside the semicircle | goal: a ball crossing the plane wholly inside the semicircle scores | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| goal: whole ball inside the semicircle | goal: a ball crossing high inside the arch scores; above the arch does not | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| goal: whole ball inside the semicircle | goal: a ball crossing just outside the semicircle does not score (and goes out of play) | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| goal: whole ball inside the semicircle | goal: ball CENTRE inside the semicircle but the ball not wholly inside (6-10 cm over the edge) does not score | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| goal: whole ball inside the semicircle | goal: a carried ball crossing the plane inside the goal is a carried goal | CANON | `engine.ts: ballPhysics, judgeGoal, checkCarryGoal` | TESTED |
| tackles and snaps | tackle: the first grounding tackle keeps the ball with the offence as a Contact Scrimmage at the spot (snapper = tackled carrier) | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | tackle: the second grounding tackle is a turnover (scrimmage for the tackling team, count 0) | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | tackle: a first tackle closer than 10 m to a goal plane moves the scrimmage line out to 10 m | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | snap: the snap must come within 10 s (snap timer starts at SNAP_LIMIT = 10) | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | snap: an expired snap timer is a missed snap: tackle count +1 and the spot 5 m back | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | snap: a missed snap at tackle count 1 is a turnover | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| tackles and snaps | snap: at a scrimmage each side is on its own side of the line the ball defines (offside prevented by positioning) | CANON | `engine.ts: tryTackle, setupSnap, missedSnap` | TESTED |
| restart after a score | after a score: scrimmage at the centre of the conceding team's own 40 m line, count 0, fresh 30 s, everyone at or behind his own 40 m line | CANON | `engine.ts: goalScored, setupSnap` | TESTED |
| restart after a score | after an awarded score (defence minor at count 0): the conceding team scrimmages at its own 40 m line | CANON | `engine.ts: goalScored, setupSnap` | TESTED |
| out of play and toss-in | out of play: toss-in to the opponent of the last toucher at the crossing point | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | out of play: opponents are at least 3 m from the toss-in | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | out of play: the ball is ready after 1.5 s and must be thrown within 4 s (timer 5.5 s; no throw before ready) | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | out of play: a tossed ball cannot score until another player controls it | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | out of play: the thrower cannot recover his own toss | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | out of play: on a goal line the toss-in slides to the edge of the Keeper Zone | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| out of play and toss-in | OWNER RULING 16 Nov: a goal-line toss-in not thrown in time restarts 5 m out from the goal line | CANON | `engine.ts: outOfPlay, setupSnap, missedSnap, tossNoScore` | TESTED |
| possession | possession: flips only after 500 ms of control by the other team (C.CONTROL_TIME) | CANON | `engine.ts: rules (ctrlT), setHolder, changePossession` | TESTED |
| possession | possession: the team keeps possession while its pass is in flight | CANON | `engine.ts: rules (ctrlT), setHolder, changePossession` | TESTED |
| possession | archer quotas: 15 arrows and 5 freezes per team possession | CANON | `engine.ts: rules (ctrlT), setHolder, changePossession` | TESTED |
| possession | archer quotas: an Archer with no arrows left cannot fire | CANON | `engine.ts: rules (ctrlT), setHolder, changePossession` | TESTED |
| possession | archer quotas: NOT reset on a completed pass; reset when possession turns over | CANON | `engine.ts: rules (ctrlT), setHolder, changePossession` | TESTED |
| archer | archer: freeze lasts 5 s, then recovery 3 m back over 2 s, then 10 s immunity | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: a legal arrow that hits freezes the target for 5 s, uses a freeze and is counted in arrowsLegal | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: an arrow at a frozen player is illegal: arrow forfeited, minor on the Archer, no freeze | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: an arrow at an immune player is illegal: arrow forfeited, minor on the Archer, no freeze | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: an arrow at a player outside the Archer's own half is illegal: arrow forfeited, minor on the Archer, no freeze | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: a frozen ball carrier drops the ball | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| archer | archer: contact with a frozen ball holder is a major foul | CANON | `engine.ts: fireArrow, arrowLegal, arrowsStep, timers` | TESTED |
| scoring | flat scoring (default): any goal is 2 (carry, thrown from any distance, own goal) | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | flat scoring: half goal is 1 | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | flat scoring: full-goal award is 2 in EVERY period (1-4, overtime, sudden death) | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | flat scoring: full-goal award is 2 in period 4 (defence minor at count 0 actually awards +2) | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | flat scoring: full-goal award is 2 in overtime (period 5) | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | banded scoring: carry 5; thrown 2 under 10 m, 3 from 10 to under 20 m, 4 from 20 m; own goal 2 | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | banded scoring: half goal 1, full-goal award 3 | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | banded scoring: a thrown goal is banded by the RELEASE distance (throwBall records it) | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| scoring | banded scoring: a carried goal is 5 | CANON | `engine.ts: goalPoints, awardPoints, award` | TESTED |
| OWNER RULINGS 16 Nov | ruling (a): a defender's deflection of a shot into his own goal is an ordinary goal for the shooter's team, not an own goal | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (b): own goal when the defending team is the holder (carried into his own goal) | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (b): own goal when the defending team is the deliberate releaser at the goal event | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (b): a loose ball with no releaser entering the goal is a goal for the attacking team, not an own goal | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (b): the own-goal state (ball.releaseTeam) resets on acquire (setHolder) and on award | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (c): a non-carrier hold by a defender is a defence minor: tackle count -1, offence scrimmages at the spot | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (c): defence minor at count 0 is a half goal (+1) in periods 1-3 | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (c): defence minor at count 0 is a full-goal award in period 4 and overtime | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| OWNER RULINGS 16 Nov | ruling (c): the behavioural hold model only ever charges a defender on a NON-carrier (event text) | OWNER RULING 16 Nov | `engine.ts: goalScored, catches, setHolder, award, defenceMinor` | TESTED |
| discipline | discipline: first major = 120 s exclusion; the team plays short (active false) | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: majors award no points | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: a major gives the fouled team a scrimmage at the spot | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: second major = disqualification | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: fourth minor = 60 s exclusion; fifth minor = disqualification | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: exclusions run on game time (not during dead balls) and the player returns after 120 s | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| discipline | discipline: offence minor is tackle count +1 with a scrimmage at the foul spot; at count 1 it is a turnover | CANON | `engine.ts: foul, majorFoul, timers` | TESTED |
| full short matches (periodLen 60, otLen 30) | pre-live marking foul is REVOKED: no foul text mentions marking and no foul is recorded outside live play | CANON | `engine.ts (whole match)` | TESTED |
| full short matches (periodLen 60, otLen 30) | match flow: a full match plays at least 4 periods, each ending with a period_end event at clock 0 | CANON | `engine.ts (whole match)` | TESTED |
| full short matches (periodLen 60, otLen 30) | determinism: the same seed gives an identical eventHash over a full short match | CANON | `engine.ts (whole match)` | TESTED |
| full short matches (periodLen 60, otLen 30) | determinism: a different seed gives a different eventHash | CANON | `engine.ts (whole match)` | TESTED |
| timeouts | timeouts: 2 per team per half | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | timeouts: in live play only the team in possession may call one | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | timeouts: either team may call one at a dead ball | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | timeouts: unused timeouts do not carry over to the second half (reset to 2 at period 3, not at period 2) | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | timeouts: 1 in overtime, none in sudden death | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | timeouts: the play clock resumes with the same time after a timeout in live play | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | coach policy: a timeout is taken at the first dead ball after the opponent scores twice in a row | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| timeouts | coach policy: alternating scores do not trigger the timeout | CANON | `engine.ts: canTimeout, takeTimeout, benchWindow, endPeriod` | TESTED |
| substitutions and injuries | squads: 22 gameday players per team, exactly 12 on the field (10 field, Keeper, Archer) | CANON | `engine.ts: benchWindow, substitute, endByForfeit; data.ts: buildLineup` | TESTED |
| substitutions and injuries | squads: a reserve Keeper and a reserve Archer are on the bench | CANON | `engine.ts: benchWindow, substitute, endByForfeit; data.ts: buildLineup` | TESTED |
| substitutions and injuries | injury: an injured player's slot is filled by a same-role reserve at the next dead ball | CANON | `engine.ts: benchWindow, substitute, endByForfeit; data.ts: buildLineup` | TESTED |
| substitutions and injuries | disqualification: the replacement comes on only after the exclusion window | CANON | `engine.ts: benchWindow, substitute, endByForfeit; data.ts: buildLineup` | TESTED |
| substitutions and injuries | forfeit: fewer than 12 of 22 available forfeits the match; exactly 12 does not | CANON | `engine.ts: benchWindow, substitute, endByForfeit; data.ts: buildLineup` | TESTED |
| review (judgeGoal) | review: a clear call (15 cm or more) is never wrong | CANON | `engine.ts: judgeGoal` | TESTED |
| review (judgeGoal) | review: a call wrong by more than 5 cm is reversed when the aggrieved team has a challenge (challenge kept) | CANON | `engine.ts: judgeGoal` | TESTED |
| review (judgeGoal) | review: without a challenge left the wrong call stands | CANON | `engine.ts: judgeGoal` | TESTED |
| review (judgeGoal) | review: within 5 cm the call stands and the challenge is lost | CANON | `engine.ts: judgeGoal` | TESTED |
| review (judgeGoal) | review: one challenge per half (reset at period 3), two in overtime | CANON | `engine.ts: judgeGoal` | TESTED |
| dribble | dribble: one dribble per possession is allowed | CANON | `engine.ts: catches, offenceMinor` | TESTED |
| dribble | dribble: a second dribble in the same possession is an offence minor (tackle count +1) | CANON | `engine.ts: catches, offenceMinor` | TESTED |
| dribble | dribble: a second dribble at tackle count 1 is a turnover | CANON | `engine.ts: catches, offenceMinor` | TESTED |
| dribble | dribble: the allowance is per possession (reset when possession changes) | CANON | `engine.ts: catches, offenceMinor` | TESTED |
| Keeper Zone | keeper zone: an attacker staying more than 5 s is a turnover at the 20 m line | CANON | `engine.ts: rules, tryTackle, keeperImmune` | TESTED |
| Keeper Zone | keeper zone: the attacker timer resets when he leaves the zone, and defenders are not timed | CANON | `engine.ts: rules, tryTackle, keeperImmune` | TESTED |
| Keeper Zone | keeper zone: contact on an immune Keeper (holding the ball in his zone) is a major, no points, Keeper's team scrimmages | CANON | `engine.ts: rules, tryTackle, keeperImmune` | TESTED |
| Keeper Zone | keeper zone: a Keeper holding the ball OUTSIDE his zone is not immune | CANON | `engine.ts: rules, tryTackle, keeperImmune` | TESTED |
| information: AI does not read other athletes' ratings | information (static): every rating access in ai.ts (.d.ovr, .d.phys, .tech.*, .a.*) is on the deciding athlete `a` | CANON | `ai.ts (static text check)` | TESTED |

## Rules with no automated test, or not modelled

| Rule | Tag | Code location | Status |
|---|---|---|---|
| Hunt false start (retake; second by the same team gives the opponent a centre scrimmage) | CANON | none | NOT IMPLEMENTED (AI and human contestants cannot start early) |
| Hunt "not set" forfeit after 10 s | CANON | none | NOT IMPLEMENTED (contestants are placed by the engine) |
| Held ball (1 s of mutual holding, alternate scrimmages) | CANON | none | NOT IMPLEMENTED (no mutual holding exists) |
| Kicking is a minor | CANON | none | NOT APPLICABLE (there is no kick action) |
| Bounce throw scores by release distance | CANON | `engine.ts: goalScored` | IMPLEMENTED (no test) |
| Offside (offence count +1, 5 m back; defence count -1, 5 m forward) | CANON | `engine.ts: moveAll, setupSnap` | NOT IMPLEMENTED as a penalty: players are held on their own side of the line at the snap, so offside cannot occur |
| Delay of game (warning, then minor) | CANON | none | NOT IMPLEMENTED (the 10 s snap limit is handled as a missed snap) |
| Head or neck contact; off-ball trip or tackle; contact after the whistle | CANON | none | NOT IMPLEMENTED (no such contact can be made; a tackle only targets the carrier) |
| Head-contact evaluation (out for the period) | CANON | none | NOT IMPLEMENTED |
| 13th player on the field | CANON | none | NOT APPLICABLE (the engine never fields 13) |
| Review of boundary calls and Keeper-immunity contact | CANON | none | NOT IMPLEMENTED (only goal / no goal is reviewed) |
| Exact tie: a shot released as the clock expires counts | CANON | `engine.ts: rules (waitShot)` | IMPLEMENTED (no test) |
| Defenders may stay in their Keeper Zone only within 5 m of an attacker | CANON | `ai.ts: defendThink` | AI behaviour only; not enforced or penalised |
| Athletes never see teammates' ratings or the coach's ranking | Brief | `ai.ts` | See the "information" test above: a text scan, not a proof. NOT VERIFIED beyond that |
| Coach timeout policy trigger 2 (last 60 s of period 4 or overtime, trailing or level) | CANON | `engine.ts: benchWindow` | IMPLEMENTED (no test) |
| Break lengths 2 / 10 / 3 / 1 minutes | CANON | `engine.ts: endPeriod` | IMPLEMENTED (shown as skippable screens; no test) |
| A team that loses a review also loses a timeout | CANON | `engine.ts: judgeGoal` | IMPLEMENTED (covered by the review test only for the challenge) |
