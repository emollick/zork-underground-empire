export type TouchRole = 'move' | 'look' | 'guard' | 'attack' | 'dodge' | 'jump' | 'interact' | 'lantern';

interface Contact { role: TouchRole; x: number; y: number; radius: number; }

export function stickVector(dx: number, dy: number, radius: number) {
  const distance = Math.hypot(dx, dy), limit = Math.max(1, radius);
  const fraction = Math.min(1, distance / limit), deadzone = 0.12;
  const strength = Math.max(0, (fraction - deadzone) / (1 - deadzone));
  const directionX = distance ? dx / distance : 0, directionY = distance ? dy / distance : 0;
  return {
    x: directionX * strength, z: directionY * strength,
    knobX: directionX * fraction * limit, knobY: directionY * fraction * limit,
    running: fraction >= 0.92,
  };
}

/** Each finger owns one control until it lifts or is cancelled. */
export class TouchInput {
  private contacts = new Map<number, Contact>();
  x = 0;
  z = 0;
  knobX = 0;
  knobY = 0;
  running = false;

  get guardHeld() { return [...this.contacts.values()].some(contact => contact.role === 'guard'); }
  get count() { return this.contacts.size; }
  owns(id: number) { return this.contacts.has(id); }

  begin(id: number, role: TouchRole, x = 0, y = 0, radius = 48) {
    if (this.contacts.has(id)) return false;
    if ((role === 'move' || role === 'look') && [...this.contacts.values()].some(contact => contact.role === role)) return false;
    this.contacts.set(id, { role, x, y, radius });
    return true;
  }

  move(id: number, x: number, y: number): { dx: number; dy: number } | undefined {
    const contact = this.contacts.get(id);
    if (!contact) return;
    if (contact.role === 'move') {
      const next = stickVector(x - contact.x, y - contact.y, contact.radius);
      this.x = next.x; this.z = next.z; this.knobX = next.knobX; this.knobY = next.knobY; this.running = next.running;
    } else if (contact.role === 'look') {
      const delta = { dx: x - contact.x, dy: y - contact.y };
      contact.x = x; contact.y = y;
      return delta;
    }
  }

  end(id: number) {
    const contact = this.contacts.get(id);
    if (!contact) return;
    this.contacts.delete(id);
    if (contact.role === 'move') this.clearMovement();
    return contact.role;
  }

  reset() { this.contacts.clear(); this.clearMovement(); }
  private clearMovement() { this.x = this.z = this.knobX = this.knobY = 0; this.running = false; }
}
