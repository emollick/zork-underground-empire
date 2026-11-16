export interface GamepadSnapshot {
  index: number;
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean }[];
}

export function gamepadStick(x: number, y: number, deadzone = 0.18) {
  const distance = Math.hypot(x, y);
  if (!Number.isFinite(distance) || distance <= deadzone) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance - deadzone) / (1 - deadzone));
  return { x: x / distance * strength, y: y / distance * strength };
}

export class GamepadInput {
  private index: number | undefined;
  private previous: boolean[] = [];
  move = { x: 0, y: 0 };
  look = { x: 0, y: 0 };
  pressed: boolean[] = [];
  held: boolean[] = [];
  active = false;

  update(pads: readonly (GamepadSnapshot | null)[]) {
    const pad = pads.find(p => p?.connected && p.mapping === 'standard' && p.index === this.index)
      ?? pads.find(p => p?.connected && p.mapping === 'standard');
    if (!pad) { this.reset(); return; }
    if (this.index !== pad.index) { this.previous = []; this.index = pad.index; }
    this.move = gamepadStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    this.look = gamepadStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    this.held = pad.buttons.map(button => button.pressed);
    this.pressed = this.held.map((held, i) => held && !this.previous[i]);
    this.previous = this.held.slice();
    this.active = this.held.some(Boolean) || !!(this.move.x || this.move.y || this.look.x || this.look.y);
  }

  reset() {
    this.index = undefined; this.previous = []; this.pressed = []; this.held = [];
    this.move = { x: 0, y: 0 }; this.look = { x: 0, y: 0 }; this.active = false;
  }
}
