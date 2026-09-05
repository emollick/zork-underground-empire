import { TouchInput } from './touch-input.ts';
import type { TouchRole } from './touch-input.ts';

type TouchAction = Exclude<TouchRole, 'move' | 'look' | 'guard'>;
interface TouchOptions {
  enabled: boolean;
  onMode: (enabled: boolean) => void;
  onLook: (dx: number, dy: number) => void;
  onAction: (action: TouchAction) => void;
  onGuard: (held: boolean) => void;
}

export function prefersTouchControls() {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches;
}

const symbol = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const icons = {
  interact: symbol('<circle cx="12" cy="12" r="7"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>'),
  attack: symbol('<path d="m6 18 12-12 2-4-4 2L4 16m0-3 7 7M2 22l4-4"/>'),
  guard: symbol('<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z"/><path d="M12 6v11"/>'),
  dodge: symbol('<path d="M20 12H5m5-5-5 5 5 5M19 5v2m0 10v2"/>'),
  jump: symbol('<path d="M12 19V4m-5 5 5-5 5 5M4 21h16"/>'),
  lantern: symbol('<path d="M8 6V4a4 4 0 0 1 8 0v2M7 6h10l2 14H5Zm3 3v8m4-8v8M4 22h16"/>'),
};

export class TouchControls {
  readonly input = new TouchInput();
  readonly root: HTMLDivElement;
  private stick: HTMLButtonElement;
  private knob: HTMLElement;
  private caption: HTMLElement;
  private buttons = new Map<TouchAction | 'guard', HTMLButtonElement>();
  private captures = new Map<number, HTMLElement>();
  private active = false;
  enabled = false;

  constructor(private canvas: HTMLCanvasElement, parent: HTMLElement, private options: TouchOptions) {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls'; this.root.className = 'touch-controls hidden';
    this.root.innerHTML = `<div class="touch-movement"><button type="button" id="touch-stick" class="touch-stick" aria-label="Movement joystick. Drag to walk; push farther to run."><span class="touch-stick-ring"></span><span id="touch-stick-knob" class="touch-stick-knob"></span></button><span id="touch-move-label" class="touch-move-label">Move</span></div><div class="touch-actions unarmed"><div class="touch-utilities">${this.button('jump', 'Jump')}${this.button('lantern', 'Lamp')}</div>${this.button('guard', 'Guard')}${this.button('attack', 'Strike')}${this.button('dodge', 'Dodge')}${this.button('interact', 'Interact')}</div>`;
    parent.append(this.root);
    this.stick = this.root.querySelector<HTMLButtonElement>('#touch-stick')!;
    this.knob = this.root.querySelector('#touch-stick-knob')!;
    this.caption = this.root.querySelector('#touch-move-label')!;
    for (const action of ['interact', 'attack', 'guard', 'dodge', 'jump', 'lantern'] as const) {
      const button = this.root.querySelector<HTMLButtonElement>(`#touch-${action}`)!;
      this.buttons.set(action, button);
      button.addEventListener('pointerdown', event => {
        if (!this.canUse() || button.disabled || event.button !== 0 || !this.input.begin(event.pointerId, action)) return;
        event.preventDefault(); event.stopPropagation();
        this.capture(event.pointerId, button); button.classList.add('pressed');
        if (action === 'guard') { button.setAttribute('aria-pressed', 'true'); this.options.onGuard(true); }
        else this.options.onAction(action);
      });
      // Pointer actions fire on contact. A keyboard or assistive click has no
      // contact event and can still activate a one-shot action.
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        if (event.detail === 0 && action !== 'guard' && this.canUse() && !button.disabled) this.options.onAction(action);
      });
      button.addEventListener('lostpointercapture', event => this.release(event.pointerId));
    }
    this.stick.addEventListener('pointerdown', event => {
      if (!this.canUse() || event.button !== 0) return;
      const rect = this.stick.getBoundingClientRect(), radius = rect.width * 0.35;
      if (!this.input.begin(event.pointerId, 'move', rect.left + rect.width / 2, rect.top + rect.height / 2, radius)) return;
      event.preventDefault(); event.stopPropagation(); this.capture(event.pointerId, this.stick);
      this.input.move(event.pointerId, event.clientX, event.clientY); this.drawStick();
    });
    this.stick.addEventListener('lostpointercapture', event => this.release(event.pointerId));
    canvas.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      this.setEnabled(true);
      if (!this.canUse() || !this.input.begin(event.pointerId, 'look', event.clientX, event.clientY)) return;
      event.preventDefault(); this.capture(event.pointerId, canvas);
    });
    canvas.addEventListener('lostpointercapture', event => this.release(event.pointerId));
    window.addEventListener('pointermove', event => {
      if (!this.canUse() || !this.input.owns(event.pointerId)) return;
      event.preventDefault();
      const look = this.input.move(event.pointerId, event.clientX, event.clientY);
      if (look) this.options.onLook(look.dx, look.dy);
      this.drawStick();
    }, { passive: false });
    window.addEventListener('pointerup', event => this.release(event.pointerId));
    window.addEventListener('pointercancel', event => this.release(event.pointerId));
    document.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') this.setEnabled(true);
    }, { capture: true, passive: true });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('resize', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    this.setEnabled(options.enabled);
  }

  private button(action: TouchAction | 'guard', label: string) {
    return `<button type="button" id="touch-${action}" class="touch-button touch-${action}" aria-label="${action === 'guard' ? 'Hold to guard or parry' : label}"${action === 'guard' || action === 'lantern' ? ' aria-pressed="false"' : ''}>${icons[action]}<span>${label}</span></button>`;
  }
  private canUse() { return this.enabled && this.active; }
  private capture(id: number, element: HTMLElement) {
    this.captures.set(id, element);
    try { element.setPointerCapture(id); } catch { /* Simulated pointers do not have native capture. */ }
  }
  private release(id: number) {
    const held = this.input.guardHeld, role = this.input.end(id), element = this.captures.get(id);
    this.captures.delete(id);
    if (element) {
      if (![...this.captures.values()].includes(element)) element.classList.remove('pressed');
      try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Capture may already have ended. */ }
    }
    if (held !== this.input.guardHeld) this.options.onGuard(this.input.guardHeld);
    if (role === 'move') this.drawStick();
    this.buttons.get('guard')!.setAttribute('aria-pressed', String(this.input.guardHeld));
  }
  private drawStick() {
    this.knob.style.transform = `translate(${this.input.knobX}px, ${this.input.knobY}px)`;
    this.stick.classList.toggle('running', this.input.running);
    this.caption.textContent = this.input.running ? 'Run' : 'Move';
  }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.reset(); this.enabled = enabled;
    document.documentElement.classList.toggle('touch-mode', enabled);
    this.root.classList.toggle('hidden', !this.canUse());
    this.options.onMode(enabled);
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.reset();
    this.root.classList.toggle('hidden', !this.canUse());
  }
  reset() {
    const held = this.input.guardHeld, captured = [...this.captures.entries()];
    this.input.reset(); this.captures.clear();
    for (const [id, element] of captured) {
      element.classList.remove('pressed');
      try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* The browser may have cancelled capture. */ }
    }
    if (held) this.options.onGuard(false);
    this.buttons.get('guard')?.setAttribute('aria-pressed', 'false'); this.drawStick();
  }
  update(hasSword: boolean, hasLantern: boolean, lanternLit: boolean, canInteract: boolean, actionLabel: string) {
    this.buttons.get('attack')!.classList.toggle('hidden', !hasSword);
    this.buttons.get('guard')!.classList.toggle('hidden', !hasSword);
    this.root.querySelector('.touch-actions')!.classList.toggle('unarmed', !hasSword);
    const lamp = this.buttons.get('lantern')!;
    lamp.classList.toggle('hidden', !hasLantern); lamp.classList.toggle('lit', lanternLit);
    lamp.setAttribute('aria-pressed', String(lanternLit));
    lamp.setAttribute('aria-label', lanternLit ? 'Turn lantern off' : 'Turn lantern on');
    const interact = this.buttons.get('interact')!;
    interact.disabled = !canInteract;
    interact.querySelector('span')!.textContent = actionLabel;
    interact.setAttribute('aria-label', actionLabel);
  }
}
