import type { ActionResult, GameState, ItemDef, RoomDef } from './types.ts';
import './item-selection.css';

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const touchHint = (value: string) => value
  .replace(/\bPress L\b/g, 'Tap Lamp').replace(/\bpress L\b/g, 'tap Lamp')
  .replace(/\bPress E\b/g, 'Tap Interact').replace(/\bpress E\b/g, 'tap Interact')
  .replace(/\bwith E\b/g, 'using Interact').replace(/\bthen E\b/g, 'then tap Interact')
  .replace(/\bDodge with Q\b/g, 'Tap Dodge').replace(/\bparry with R\b/g, 'hold Guard to parry')
  .replace(/\bStrike with F\b/g, 'Tap Strike');
const icon = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2 25 15 38 20 25 25 20 38 15 25 2 20 15 15Z" fill="none" stroke="currentColor"/><path d="m20 9 4 11-4 11-4-11Z" fill="currentColor"/></svg>`;

export class GameUI {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  title: HTMLDivElement;
  overlay: HTMLDivElement;
  hud: HTMLDivElement;
  currentPanel = '';
  onAction: (action: string) => void = () => {};
  onChoice: (action: string) => void = () => {};
  onSetting: (key: string, value: string) => void = () => {};
  private toastUntil = 0;
  private noticeUntil = 0;
  private titleUntil = 0;
  private lastHealth = -1;
  private lastStamina = -1;
  private toastNode: HTMLElement;
  private locationNode: HTMLElement;
  private lastPrompt = '';
  private deathMessage = '';
  private lastLookMode = 'inactive';
  private lookHintUntil = 0;
  private touchMode = false;
  private currentHint = '';
  constructor() {
    this.root = document.querySelector<HTMLDivElement>('#app')!;
    this.root.innerHTML = `
      <canvas id="world" aria-label="Zork 3D game world" tabindex="0"></canvas>
      <div class="loading-screen" id="loading"><div class="loading-mark">${icon}</div><p>THE GREAT UNDERGROUND EMPIRE</p><div class="loading-track"><i id="loading-bar"></i></div><span id="loading-label">Preparing your expedition</span></div>
      <div id="title-screen" class="title-screen hidden">
        <div class="title-top"><span class="studio-mark">${icon}</span><span>AN ADVENTURE BELOW THE WORLD</span></div>
        <div class="title-content"><div class="title-rule"></div><h1>ZORK</h1><p class="title-subtitle">THE GREAT UNDERGROUND EMPIRE</p><p class="title-description">A white house. A brass lantern.<br>An entire world beneath your feet.</p>
          <div class="title-actions"><button class="primary-button hidden" data-action="continue" id="continue-button">Continue expedition <span>→</span></button><button class="primary-button" data-action="start" id="start-button">Begin expedition <span>↗</span></button><button class="quiet-button" data-action="settings">Settings & controls</button></div>
          <p class="touch-only title-touch-note">Move with the left stick.<br>Swipe the right side to look around.</p>
        </div><div class="title-footer"><span>A FIRST-PERSON ACTION ADVENTURE</span><button data-action="credits">About this adaptation</button><span id="title-input-mode">KEYBOARD + MOUSE</span></div>
      </div>
      <div id="hud" class="hud hidden">
        <div class="top-left"><span class="small-mark">${icon}</span><div><span id="region">THE WHITE HOUSE</span><small id="room-name">West of House</small></div></div>
        <div class="compass" aria-label="Compass"><div id="compass-track"></div><i></i></div>
        <div class="top-right"><button class="hud-button" data-action="journal"><kbd>J</kbd> Journal</button><button class="hud-button touch-only" data-action="inventory">Satchel</button><button class="hud-button" data-action="pause"><span>Ⅱ</span> Pause</button></div>
        <div class="objective" id="objective"><span id="objective-label">THE EXPEDITION</span><p id="objective-text"></p></div>
        <div id="room-reveal" class="room-reveal hidden"><span id="room-reveal-subtitle"></span><h2 id="room-reveal-name"></h2><i></i></div>
        <div class="crosshair" id="crosshair"><i></i><b></b></div>
        <button type="button" id="interact-prompt" class="interact-prompt hidden" data-action="interact"><span class="prompt-key" id="prompt-key">E</span><span class="prompt-copy"><strong id="prompt-name"></strong><small id="prompt-detail"></small></span></button>
        <div class="enemy-hud hidden" id="enemy-hud"><span id="enemy-intent"></span><div class="enemy-name" id="enemy-name"></div><div class="enemy-bar"><i id="enemy-health"></i></div><small id="combat-help">LMB / F Strike · RMB / R Parry · Q Dodge</small></div>
        <div class="player-status"><div class="status-icon">${icon}</div><div class="status-bars"><div class="health-track"><i id="health-bar"></i></div><div class="stamina-track"><i id="stamina-bar"></i></div><span id="health-label">100</span></div></div>
        <div class="equipment"><span id="lamp-status" class="lamp-status"><span>♧</span><kbd>L</kbd> LANTERN</span><span id="treasure-count">0 / 19</span><button data-action="inventory"><kbd>TAB</kbd> Satchel</button></div>
        <div id="toast" class="toast hidden" role="status"><span id="toast-title"></span><p id="toast-text"></p></div>
        <div class="tutorial" id="tutorial"><span><kbd>W A S D</kbd> Move</span><span><kbd>SHIFT</kbd> Run</span><span><kbd>E</kbd> Interact</span><span><kbd>ESC</kbd> Pause</span></div>
        <div id="look-hint" class="look-hint hidden">Click to look around · Esc to pause</div>
        <div class="save-indicator" id="save-indicator">◇ Expedition saved</div>
      </div>
      <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true"></div>
      <div id="transition" class="transition"></div>
      <input type="file" id="import-save" accept="application/json,.json" hidden />
      <div id="fatal-error" class="fatal-error hidden"></div>`;
    this.canvas = document.querySelector('#world')!; this.title = document.querySelector('#title-screen')!;
    this.overlay = document.querySelector('#overlay')!; this.hud = document.querySelector('#hud')!;
    this.toastNode = document.querySelector('#toast')!; this.locationNode = document.querySelector('#room-reveal')!;
    this.root.addEventListener('click', event => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-choice]');
      if (choice) { this.onChoice(choice.dataset.choice!); return; }
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (action) this.onAction(action.dataset.action!);
    });
    this.root.addEventListener('input', event => {
      const target = event.target as HTMLInputElement;
      if (target.dataset.setting) this.onSetting(target.dataset.setting, target.type === 'checkbox' ? String(target.checked) : target.value);
      if (target.type === 'range') { const output = target.closest('label')?.querySelector('output'); if (output) output.textContent = target.value; }
    });
    this.overlay.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const focusable = Array.from(this.overlay.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')).filter(el => !el.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    });
  }
  setTouchMode(enabled: boolean) {
    this.touchMode = enabled;
    document.documentElement.classList.toggle('touch-mode', enabled);
    this.text('title-input-mode', enabled ? 'TOUCH CONTROLS' : 'KEYBOARD + MOUSE');
    this.text('prompt-key', enabled ? 'Tap' : 'E');
    this.text('combat-help', enabled ? 'Strike · Hold Guard · Dodge' : 'LMB / F Strike · RMB / R Parry · Q Dodge');
    this.text('map-guidance', enabled ? 'Drag to explore the map.' : 'Scroll to explore the map.');
    document.querySelector('#tutorial')!.innerHTML = enabled
      ? '<span>Left stick to move</span><span>Swipe right side to look</span>'
      : '<span><kbd>W A S D</kbd> Move</span><span><kbd>SHIFT</kbd> Run</span><span><kbd>E</kbd> Interact</span><span><kbd>ESC</kbd> Pause</span>';
    if (enabled) document.querySelector('#look-hint')!.classList.add('hidden');
    if (this.currentPanel === 'settings') this.overlay.querySelector('.controls-guide')!.innerHTML = this.controlsGuide();
    const hint = this.overlay.querySelector('.hint-text');
    if (hint) hint.textContent = enabled ? touchHint(this.currentHint) : this.currentHint;
  }
  private controlsGuide() {
    const controls = this.touchMode
      ? '<dt>Move / run</dt><dd>Left stick / push farther</dd><dt>Look around</dt><dd>Swipe the right side</dd><dt>Interact</dt><dd>Tap the prompt or action</dd><dt>Strike</dt><dd>Strike button</dd><dt>Block / parry</dt><dd>Hold Guard</dd><dt>Dodge</dt><dd>Dodge + stick direction</dd><dt>Jump / lantern</dt><dd>Jump / Lamp</dd><dt>Journal / map</dt><dd>Journal, then Map</dd><dt>Satchel / pause</dt><dd>Buttons at the top</dd>'
      : '<dt>Move / look</dt><dd>WASD / mouse</dd><dt>Run / jump</dt><dd>Shift / Space</dd><dt>Interact</dt><dd>E</dd><dt>Strike</dt><dd>Left click or F</dd><dt>Block / parry</dt><dd>Right click or R</dd><dt>Dodge</dt><dd>Q + a direction</dd><dt>Lantern</dt><dd>L</dd><dt>Journal / map</dt><dd>J / M</dd><dt>Satchel / pause</dt><dd>Tab / Esc</dd>';
    return `<h3>The essentials</h3><dl>${controls}</dl><p>Parry just before a blow lands to stagger an enemy. Dodge through an attack, then strike during its recovery.</p><p>Tools are used where they belong. Explore, examine, and let the journal give you a nudge if you need one.</p><p class="muted">${this.touchMode ? 'Drag farther from the center of the stick to run. Lift your thumb to stop. Swipe anywhere on the right side of the world to turn; swiping never attacks. Combat and lamp controls appear when you have the equipment.' : 'Mouse look stays on while you play. If the pointer reaches the edge of the view, keep it there to continue turning. Arrow keys also turn the camera. Esc pauses and releases the mouse.'}</p>`;
  }
  loading(progress: number, label = 'Preparing your expedition') { (document.querySelector('#loading-bar') as HTMLElement).style.width = `${progress * 100}%`; this.text('loading-label', label); }
  ready(hasSave: boolean) { document.querySelector('#loading')!.classList.add('hidden'); this.showTitle(hasSave); }
  showTitle(hasSave: boolean) {
    this.close(); this.title.classList.remove('hidden'); this.hud.classList.add('hidden');
    this.canvas.inert = true;
    document.querySelector('#continue-button')!.classList.toggle('hidden', !hasSave);
    const start = document.querySelector('#start-button')!; start.classList.toggle('secondary-button', hasSave);
    start.innerHTML = hasSave ? 'New expedition <span>↗</span>' : 'Begin expedition <span>↗</span>';
    this.title.querySelector<HTMLButtonElement>(hasSave ? '#continue-button' : '#start-button')?.focus({ preventScroll: true });
  }
  play() { this.title.classList.add('hidden'); this.hud.classList.remove('hidden'); this.close(); }
  open(panel: string, body: string, title = '') {
    this.currentPanel = panel; this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `<div class="panel panel-${panel}">${title ? `<header class="panel-header"><div><span class="eyebrow">THE GREAT UNDERGROUND EMPIRE</span><h2>${escapeHtml(title)}</h2></div><button class="close-button" data-action="close" aria-label="Close">×</button></header>` : ''}${body}</div><div id="panel-notice" class="panel-notice hidden" role="status"></div>`;
    const heading = this.overlay.querySelector('h2');
    if (heading) { heading.id = 'panel-heading'; this.overlay.setAttribute('aria-labelledby', heading.id); }
    this.title.inert = true; this.hud.inert = true; this.canvas.inert = true;
    this.overlay.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }
  close() { this.currentPanel = ''; this.overlay.classList.add('hidden'); this.overlay.innerHTML = ''; this.overlay.removeAttribute('aria-labelledby'); this.title.inert = false; this.hud.inert = false; this.canvas.inert = false; }
  pause(room: RoomDef) {
    this.open('pause', `<div class="pause-place"><span>EXPEDITION PAUSED</span><h2>${escapeHtml(room.name)}</h2></div><div class="pause-actions"><button class="primary-button" data-action="resume">Return to the adventure <span>→</span></button><button data-action="journal">Journal & map</button><button data-action="settings">Settings & controls</button><button data-action="export">Export saved expedition</button><button data-action="import">Import saved expedition</button><button class="muted" data-action="title">Save & return to title</button></div><small class="pause-note">Progress saves automatically. Your expedition stays on this device.</small>`);
  }
  settings(state: GameState) {
    const s = state.settings;
    this.open('settings', `<div class="settings-columns"><div class="settings-list"><label>Sound <output>${Math.round(s.volume * 100)}</output><input aria-label="Sound volume" data-setting="volume" type="range" min="0" max="100" value="${s.volume * 100}"/></label><label>Look sensitivity <output>${s.sensitivity}</output><input aria-label="Look sensitivity" data-setting="sensitivity" type="range" min="0.4" max="2" step="0.1" value="${s.sensitivity}"/></label><label>Field of view <output>${s.fov}</output><input aria-label="Field of view" data-setting="fov" type="range" min="60" max="100" step="1" value="${s.fov}"/></label><label>Graphics<select aria-label="Graphics quality" data-setting="quality"><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High · cinematic lighting</option><option value="balanced" ${s.quality === 'balanced' ? 'selected' : ''}>Balanced · smoother performance</option></select></label><label>Combat challenge<select aria-label="Combat challenge" data-setting="difficulty"><option value="explorer" ${s.difficulty === 'explorer' ? 'selected' : ''}>Explorer · generous timing, lighter damage</option><option value="adventurer" ${!s.difficulty || s.difficulty === 'adventurer' ? 'selected' : ''}>Adventurer · deliberate, readable combat</option><option value="veteran" ${s.difficulty === 'veteran' ? 'selected' : ''}>Veteran · faster attacks, harsher mistakes</option></select></label><label class="toggle-label"><input data-setting="motion" type="checkbox" ${s.motion ? 'checked' : ''}/> Camera motion</label></div><div class="controls-guide">${this.controlsGuide()}</div></div>`, 'Settings & controls');
  }
  choice(result: ActionResult) {
    if (result.itemSelection) { this.itemChoice(result); return; }
    const prompt = result.prompt ? `<form class="spoken-action"><label for="spoken-words">${escapeHtml(result.prompt.label)}</label><div><input id="spoken-words" name="words" type="text" inputmode="text" maxlength="60" autocomplete="off" autocorrect="off" autocapitalize="none" enterkeyhint="go" spellcheck="false" required /><button class="primary-button" type="submit">${escapeHtml(result.prompt.submit)} <span>→</span></button></div></form>` : '';
    this.open('interaction', `<span class="eyebrow">EXAMINE</span><h2>${escapeHtml(result.title ?? 'A closer look')}</h2><p class="interaction-text">${escapeHtml(result.message)}</p><div class="choice-list">${(result.choices ?? []).map(c => `<button data-choice="${escapeHtml(c.action)}">${escapeHtml(c.label)}<span>→</span></button>`).join('')}</div>${prompt}<button class="text-button" data-action="close">Step away</button>`);
    if (result.prompt) {
      const action = result.prompt.action, field = this.overlay.querySelector<HTMLInputElement>('#spoken-words')!;
      this.overlay.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); if (field.value.trim()) this.onChoice(`${action}:${field.value.trim()}`); });
      if (!this.touchMode) requestAnimationFrame(() => field.focus());
      else field.addEventListener('focus', () => requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest' })));
    }
  }
  private itemChoice(result: ActionResult) {
    let panel = this.overlay.querySelector<HTMLElement>('.item-selection-panel');
    const continuing = !!panel;
    if (!panel) {
      this.open('interaction', `<div class="item-selection-intro"><span class="eyebrow">EXAMINE</span><h2 tabindex="-1"></h2><p class="interaction-text item-selection-description"></p></div><div class="item-selection-heading"><h3 id="item-selection-label">Choose an item</h3><span class="item-selection-count"></span></div><p class="item-selection-feedback" role="status" aria-live="polite" aria-atomic="true"></p><div class="item-selection-list" role="group" aria-labelledby="item-selection-label"></div><footer class="item-selection-footer"><button type="button" class="text-button" data-action="close">Step away</button></footer>`);
      panel = this.overlay.querySelector<HTMLElement>('.panel-interaction')!;
      panel.classList.add('item-selection-panel');
      // Start on the scene heading without suggesting one carried item.
      const heading = panel.querySelector<HTMLHeadingElement>('h2')!;
      heading.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const buttons = panel!.querySelectorAll<HTMLButtonElement>('button');
        (event.shiftKey ? buttons[buttons.length - 1] : buttons[0])?.focus();
        event.preventDefault(); event.stopPropagation();
      });
    }
    const heading = panel.querySelector<HTMLHeadingElement>('h2')!;
    heading.textContent = result.title ?? 'A closer look';
    panel.querySelector<HTMLElement>('.item-selection-description')!.textContent = result.message;
    const choices = result.choices ?? [];
    panel.querySelector<HTMLElement>('.item-selection-count')!.textContent = choices.length ? `${choices.length} carried` : '';

    const list = panel.querySelector<HTMLElement>('.item-selection-list')!;
    const signature = JSON.stringify(choices);
    // Keep the actual buttons on retries so browser focus and list scroll survive.
    if (list.dataset.choices !== signature) {
      const scrollTop = list.scrollTop;
      const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement)
        ? document.activeElement.closest<HTMLButtonElement>('[data-choice]')?.dataset.choice : undefined;
      list.innerHTML = choices.length
        ? choices.map(choice => `<button type="button" data-choice="${escapeHtml(choice.action)}" aria-label="Use ${escapeHtml(choice.label)}"><span>${escapeHtml(choice.label)}</span><span class="item-selection-arrow" aria-hidden="true">→</span></button>`).join('')
        : '<p class="item-selection-empty">Your satchel is empty.</p>';
      list.dataset.choices = signature; list.scrollTop = scrollTop;
      if (focused) {
        const replacement = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-choice]')).find(button => button.dataset.choice === focused);
        (replacement ?? heading).focus({ preventScroll: true });
      }
    }
    panel.querySelector<HTMLElement>('.item-selection-feedback')!.textContent = result.feedback ?? '';
    if (!continuing) heading.focus({ preventScroll: true });
    else {
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && list.contains(focused)) {
        // Feedback can shorten the list. Reveal only the clipped part of the retry target.
        const viewport = list.getBoundingClientRect(), bounds = focused.getBoundingClientRect();
        const top = viewport.top + list.clientTop + 2, bottom = viewport.top + list.clientTop + list.clientHeight - 2;
        if (bounds.top < top) list.scrollTop += bounds.top - top;
        else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom;
      }
    }
  }
  journal(state: GameState, rooms: Record<string, RoomDef>, items: Record<string, ItemDef>, objective: { title: string; text: string }, tab = 'journal', selectedItem = '', hintText = '', hintLevel = 0) {
    this.currentHint = hintText;
    const tabs = `<nav class="journal-tabs">${[['journal', 'Journal'], ['map', 'Map'], ['inventory', 'Satchel']].map(([id, label]) => `<button data-action="${id}" class="${id === tab ? 'selected' : ''}">${label}</button>`).join('')}<span>${state.deposited.length} / 19 treasures in the case</span></nav>`;
    let body = '';
    if (tab === 'journal') {
      const hintLabel = hintLevel >= 3 ? 'Repeat the solution' : hintLevel === 2 ? 'Show the solution' : hintLevel === 1 ? 'A clearer hint' : 'A nudge, please';
      body = `<div class="journal-content"><aside class="current-lead"><span class="eyebrow">YOUR OBSERVATIONS</span><h3>${escapeHtml(objective.title)}</h3><p>${escapeHtml(objective.text)}</p><button class="text-button hint-button" data-action="hint">${hintLabel} <span>↗</span></button>${hintText ? `<p class="hint-text">${escapeHtml(this.touchMode ? touchHint(hintText) : hintText)}</p>` : ''}<div class="journal-stats"><span>${state.visited.length} places discovered</span><span>${Math.floor(state.playTime / 60)} minutes in the empire</span></div></aside><div class="journal-entries">${[...state.journal].reverse().map(e => `<article><span>◇</span><div><h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.text)}</p></div></article>`).join('') || '<p>Your observations will be recorded here as you explore.</p>'}</div></div>`;
    } else if (tab === 'map') {
      const visited = Object.values(rooms).filter(r => state.visited.includes(r.id));
      const nextIds = new Set(visited.flatMap(r => r.exits.filter(e => !e.requires || state.flags[e.requires]).map(e => e.to)));
      const list = Object.values(rooms).filter(r => state.visited.includes(r.id) || nextIds.has(r.id)), xs = list.map(r => r.map[0]), ys = list.map(r => r.map[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const mapWidth = Math.max(650, (maxX - minX) * 200 + 220), mapHeight = Math.max(280, (maxY - minY) * 96 + 140);
      const p = (r: RoomDef) => [(mapWidth - (maxX - minX) * 200) / 2 + (r.map[0] - minX) * 200, 60 + (r.map[1] - minY) * 96];
      const edges = new Set<string>();
      const lines = list.flatMap(room => room.exits.map(exit => {
        if (!rooms[exit.to] || !state.visited.includes(room.id) || exit.requires && !state.flags[exit.requires]) return '';
        const key = [room.id, exit.to].sort().join(':'); if (edges.has(key)) return ''; edges.add(key);
        const a = p(room), b = p(rooms[exit.to]); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
      })).join('');
      const nodes = list.map(r => {
        const [x, y] = p(r), known = state.visited.includes(r.id), words = (known ? r.name : 'Unexplored route').split(' '), lines = [''];
        for (const word of words) { if ((lines[lines.length - 1] + ' ' + word).trim().length > 16) lines.push(word); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + word).trim(); }
        return `<g class="${r.id === state.room ? 'map-current' : known ? '' : 'map-unknown'}"><circle cx="${x}" cy="${y}" r="${r.id === state.room ? 8 : 5}"/><text x="${x}" y="${y + 30}" text-anchor="middle">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? 24 : 0}">${escapeHtml(line)}</tspan>`).join('')}</text></g>`;
      }).join('');
      const camps = ['living_room', 'round_room', 'temple', 'dam'].filter(id => state.flags[`rest_${id}`]);
      body = `<div class="map-container" tabindex="0" role="region" aria-label="Scrollable expedition map"><svg class="world-map" viewBox="0 0 ${mapWidth} ${mapHeight}" style="min-width:${mapWidth}px;height:${mapHeight}px;max-height:none" role="img" aria-label="Map of the places you have discovered"><g class="map-lines">${lines}</g>${nodes}</svg></div><div class="map-footer"><p><span id="map-guidance">${this.touchMode ? 'Drag to explore the map.' : 'Scroll to explore the map.'}</span> <span class="gold">◇</span> Your position</p><div><span>RETURN TO A SAFE PLACE</span>${camps.map(id => `<button data-action="camp:${id}">${escapeHtml(rooms[id].name)}</button>`).join('') || '<small>Discover a rest site to unlock travel.</small>'}</div></div>`;
    } else {
      const owned = state.inventory.filter(id => items[id]); const selected = items[selectedItem] ?? items[owned[0]];
      body = `<div class="satchel-content"><div class="item-list">${owned.map(id => `<button data-action="inspect:${escapeHtml(id)}" class="${selected?.id === id ? 'selected' : ''}"><span class="item-glyph">${items[id].treasure ? '◇' : '·'}</span><span>${escapeHtml(items[id].name)}</span>${items[id].treasure ? '<small>TREASURE</small>' : ''}</button>`).join('') || '<p>Your satchel is empty. The mailbox seems like a reasonable place to begin.</p>'}</div><div class="item-description">${selected ? `<span class="eyebrow">${selected.treasure ? 'TREASURE OF THE EMPIRE' : 'IN YOUR SATCHEL'}</span><div class="item-seal">${selected.treasure ? '◇' : icon}</div><h3>${escapeHtml(selected.name)}</h3><p>${escapeHtml(selected.description)}</p><small>Examine a place or creature to choose an item to use there.</small>` : '<span class="empty-satchel">An adventure begins with empty pockets.</span>'}</div></div>`;
    }
    this.open(tab, tabs + body, 'The expedition');
    if (tab === 'map') requestAnimationFrame(() => {
      const container = this.overlay.querySelector<HTMLElement>('.map-container'), current = this.overlay.querySelector<SVGGraphicsElement>('.map-current');
      if (!container || !current) return;
      const box = current.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      container.scrollTop += box.y - viewport.y - viewport.height / 2 + box.height / 2;
      container.scrollLeft += box.x - viewport.x - viewport.width / 2 + box.width / 2;
    });
  }
  credits() {
    this.open('credits', `<div class="credits-body"><h3>A return to the Great Underground Empire</h3><p>A condensed 3D adaptation of Zork I’s treasure-and-barrow arc, with original environments, first-person combat, nineteen recoverable treasures, and the ancient map.</p><p>Based on Zork by Marc Blank, Dave Lebling, Bruce Daniels, and Tim Anderson, and the MIT-licensed Zork I source released by Microsoft in 2025. This is an independent adaptation.</p><p>World geometry, creatures, interface, and sound were created for this game. Photogrammetric surface materials are CC0 assets from Poly Haven.</p><a href="https://github.com/emollick/zork-underground-empire" target="_blank" rel="noreferrer">This adaptation on GitHub ↗</a><a href="./licenses/ADAPTATION-MIT.txt" target="_blank" rel="noreferrer">Adaptation source license ↗</a><a href="https://github.com/historicalsource/zork1" target="_blank" rel="noreferrer">Original Zork I source ↗</a><a href="./licenses/ZORK-MIT.txt" target="_blank" rel="noreferrer">Zork source license ↗</a><a href="https://polyhaven.com/license" target="_blank" rel="noreferrer">Poly Haven asset license ↗</a></div>`, 'About this adventure');
  }
  death(room: RoomDef, message?: string) {
    if (message !== undefined) this.deathMessage = message;
    this.open('death', `<span class="eyebrow">THE EMPIRE HAS CLAIMED ANOTHER</span><h2>You have died.</h2>${this.deathMessage ? `<p>${escapeHtml(this.deathMessage)}</p>` : ''}<p>Your discoveries and belongings are safe.</p><button class="primary-button" data-action="retry">Return to ${escapeHtml(room.name)} <span>→</span></button><button class="text-button" data-action="settings">Adjust the challenge</button>`);
  }
  ending(state: GameState) {
    this.open('ending', `<div class="ending-mark">${icon}</div><span class="eyebrow">MASTER OF THE GREAT UNDERGROUND EMPIRE</span><h2>Inside the<br>Barrow</h2><p>As you enter the barrow, the door closes inexorably behind you.</p><p class="ending-description">You have mastered ZORK: The Great Underground Empire.</p><div class="ending-stats"><div><strong>19</strong><span>TREASURES RETURNED</span></div><div><strong>${state.visited.length}</strong><span>PLACES DISCOVERED</span></div><div><strong>${Math.floor(state.playTime / 60)}</strong><span>MINUTES BELOW</span></div></div><button class="primary-button" data-action="resume">Keep exploring <span>→</span></button><button class="text-button" data-action="export">Keep a record of the expedition</button>`);
  }
  toast(message: string, title = '', duration = 6) {
    const notice = this.overlay.querySelector<HTMLElement>('#panel-notice');
    if (this.currentPanel && notice) {
      notice.innerHTML = `${title ? `<strong>${escapeHtml(title)}</strong>` : ''}<p>${escapeHtml(message)}</p>`;
      notice.classList.remove('hidden'); this.noticeUntil = performance.now() + duration * 1000;
      return;
    }
    this.text('toast-title', title); this.text('toast-text', message); this.toastNode.classList.remove('hidden'); this.toastUntil = performance.now() + duration * 1000;
  }
  location(room: RoomDef, reveal = true) {
    this.text('region', room.subtitle); this.text('room-name', room.name); this.text('room-reveal-subtitle', room.subtitle); this.text('room-reveal-name', room.name);
    if (!reveal) { this.locationNode.classList.add('hidden'); return; }
    this.locationNode.classList.remove('hidden'); this.titleUntil = performance.now() + 4100;
  }
  objective(value: { title: string; text: string }) { this.text('objective-label', value.title); this.text('objective-text', value.text); }
  prompt(name: string, detail = '') { const key = name + detail; if (key === this.lastPrompt) return; this.lastPrompt = key; document.querySelector('#interact-prompt')!.classList.toggle('hidden', !name); document.querySelector('#crosshair')!.classList.toggle('targeted', !!name); this.text('prompt-name', name); this.text('prompt-detail', detail); }
  enemy(name: string, fraction: number, intent: string, show: boolean) { document.querySelector('#enemy-hud')!.classList.toggle('hidden', !show); this.text('enemy-name', name); this.text('enemy-intent', intent); (document.querySelector('#enemy-health') as HTMLElement).style.width = `${Math.max(0, fraction * 100)}%`; document.querySelector('#enemy-intent')!.classList.toggle('danger', intent.includes('Incoming')); }
  update(state: GameState, lookMode: 'captured' | 'free' | 'inactive' | 'touch', active: boolean) {
    if (this.lastHealth !== state.health) { this.lastHealth = state.health; (document.querySelector('#health-bar') as HTMLElement).style.width = `${Math.max(0, state.health)}%`; this.text('health-label', String(Math.ceil(state.health))); }
    if (Math.abs(this.lastStamina - state.stamina) > 0.8) { this.lastStamina = state.stamina; (document.querySelector('#stamina-bar') as HTMLElement).style.width = `${state.stamina}%`; }
    document.querySelector('#lamp-status')!.classList.toggle('lit', state.lantern);
    document.querySelector('#lamp-status')!.classList.toggle('hidden', !state.inventory.includes('lantern'));
    this.text('treasure-count', `${state.deposited.length} / 19`);
    const fighting = !document.querySelector('#enemy-hud')!.classList.contains('hidden');
    if (lookMode !== this.lastLookMode) {
      this.lastLookMode = lookMode; this.lookHintUntil = performance.now() + 7000;
      this.text('look-hint', lookMode === 'free' ? 'Move the mouse to look · Keep it near an edge to turn further · Esc to pause' : 'Click to look around · Esc to pause');
    }
    document.querySelector('#look-hint')!.classList.toggle('hidden', this.touchMode || lookMode === 'touch' || lookMode === 'captured' || !active || fighting || lookMode === 'free' && performance.now() > this.lookHintUntil);
    const degrees = ((-state.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const marks = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const track = document.querySelector('#compass-track')!;
    track.innerHTML = marks.map((label, i) => { let offset = i * 45 - degrees; if (offset > 180) offset -= 360; if (offset < -180) offset += 360; return Math.abs(offset) <= 80 ? `<span style="left:calc(50% + ${offset * 2}px);opacity:${1 - Math.abs(offset) / 95}">${label}</span>` : ''; }).join('');
    if (performance.now() > this.toastUntil) this.toastNode.classList.add('hidden');
    if (performance.now() > this.noticeUntil) this.overlay.querySelector('#panel-notice')?.classList.add('hidden');
    if (performance.now() > this.titleUntil) this.locationNode.classList.add('hidden');
    document.querySelector('#tutorial')!.classList.toggle('hidden', state.playTime > (this.touchMode ? 15 : 65) || state.visited.length > 3 || fighting);
  }
  saveIndicator() { const el = document.querySelector('#save-indicator')!; el.classList.add('show'); window.setTimeout(() => el.classList.remove('show'), 1800); }
  fade(dark: boolean) { document.querySelector('#transition')!.classList.toggle('dark', dark); }
  error(message: string) { const el = document.querySelector('#fatal-error')!; el.classList.remove('hidden'); el.innerHTML = `<h2>The expedition could not start.</h2><p>${escapeHtml(message)}</p><button>Try again</button>`; el.querySelector('button')!.addEventListener('click', () => location.reload()); }
  private text(id: string, value: string) { const el = document.getElementById(id); if (el && el.textContent !== value) el.textContent = value; }
}
