// First-time tutorial cards. Wording differs for touch and keyboard.
export const TUT_KEY = 'sbb_tutorial_done';

export interface TutCard { title: string; body: string }

export function tutorialCards(isTouch: boolean): TutCard[] {
  const k = (s: string) => `<span class="kbd">${s}</span>`;
  return isTouch ? [
    { title: 'MOVE AND SPRINT', body: 'Drag anywhere on the left half of the screen: a stick appears under your thumb. Push it to the outer ring, or hold <b>SPRINT</b>, to run flat out. Sprinting drains stamina.' },
    { title: 'PASS AND CATCH', body: 'Tap <b>PASS</b> to throw to the open teammate in the direction you are pushing. You take over the receiver at once. Let go of the stick and they run onto the ball for you.' },
    { title: 'TACKLE: TWO AND IT TURNS OVER', body: 'On defence tap <b>TACKLE</b> next to the ball carrier (<b>SWITCH</b> picks the teammate nearest the ball). A possession survives one tackle. The second tackle is a turnover.' },
    { title: 'SHOOT INTO THE SEMICIRCLE', body: 'Tap <b>SHOOT</b> to throw at the semicircular goal. Carrying the ball in scores too. The Keeper guards it, so shoot from a good angle.' },
    { title: 'THE ARCHER AND THE PLAY CLOCK', body: 'Tap <b>ARCHER</b> to fire a freezing arrow. It is legal only at an opponent inside your Archer\'s zone (your own half): the button dims when there is no legal target. You have 15 arrows and 5 freezes. Watch the ring by the scoreboard: 30 seconds to make a play, and it turns red under 8.' },
  ] : [
    { title: 'MOVE AND SPRINT', body: `Move with ${k('W A S D')} or the arrow keys. Hold ${k('Shift')} to sprint. Sprinting drains stamina. Gamepad: left stick, RB to sprint.` },
    { title: 'PASS AND CATCH', body: `Press ${k('Space')} to pass to the open teammate in the direction you are pushing. You take over the receiver at once. Leave the keys alone and they run onto the ball for you.` },
    { title: 'TACKLE: TWO AND IT TURNS OVER', body: `On defence press ${k('J')} next to the ball carrier (${k('K')} switches to the teammate nearest the ball). A possession survives one tackle. The second tackle is a turnover.` },
    { title: 'SHOOT INTO THE SEMICIRCLE', body: `Press ${k('L')} to throw at the semicircular goal. Carrying the ball in scores too. The Keeper guards it, so shoot from a good angle.` },
    { title: 'THE ARCHER AND THE PLAY CLOCK', body: `Press ${k('E')} to fire a freezing arrow. It is legal only at an opponent inside your Archer's zone (your own half): the HUD shows TARGET IN ZONE or NO LEGAL TARGET. You have 15 arrows and 5 freezes. Watch the ring by the scoreboard: 30 seconds to make a play, and it turns red under 8. ${k('T')} calls a timeout, ${k('Esc')} pauses.` },
  ];
}

export const tutorialDone = () => { try { return localStorage.getItem(TUT_KEY) === '1'; } catch { return true; } };
export const markTutorialDone = () => { try { localStorage.setItem(TUT_KEY, '1'); } catch { /* private mode */ } };
