// STUB contract for procedural WebAudio SFX/music (must be mutable). Replaced by the look workstream.
export const audio = {
  muted: false,
  unlock(): void { /* resume AudioContext on first user gesture */ },
  setMuted(m: boolean): void { this.muted = m; },
  toggle(): boolean { this.muted = !this.muted; return this.muted; },
};
