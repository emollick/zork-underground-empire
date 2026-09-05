export type Difficulty = 'explorer' | 'adventurer' | 'veteran';
export const BALANCE = {
  explorer: { damage: 0.5, tell: 1.3, enemyHealth: 0.8, staminaRecovery: 27 },
  adventurer: { damage: 1, tell: 1, enemyHealth: 1, staminaRecovery: 24 },
  veteran: { damage: 1.3, tell: 0.85, enemyHealth: 1.2, staminaRecovery: 22 },
} as const;
export const ATTACK_COST = 17;
export const DODGE_COST = 24;
export const SWORD_DAMAGE = 27;
export const PARRY_WINDOW = 0.27;
export const PARRY_STAGGER = 1.1;
export const ATTACK_COOLDOWN = 0.55;
export interface StrikeResult { damage: number; staminaCost: number; parried: boolean; blocked: boolean; }
export function resolveStrike(baseDamage: number, difficulty: Difficulty, dodging: boolean, blocking: boolean, blockAge: number, stamina: number): StrikeResult {
  if (dodging) return { damage: 0, staminaCost: 0, parried: false, blocked: false };
  if (blocking && blockAge <= PARRY_WINDOW && stamina >= 8) return { damage: 0, staminaCost: 8, parried: true, blocked: true };
  if (blocking && stamina >= 17) return { damage: Math.round(baseDamage * BALANCE[difficulty].damage * 0.12), staminaCost: 17, parried: false, blocked: true };
  return { damage: Math.round(baseDamage * BALANCE[difficulty].damage), staminaCost: 0, parried: false, blocked: false };
}
export function enemyTiming(kind: string, difficulty: Difficulty, hurtFraction: number) {
  const fast = kind === 'thief';
  return { tell: (fast ? 0.84 : 1.2) * BALANCE[difficulty].tell, recovery: fast ? (hurtFraction > 0.55 ? 1.02 : 1.3) : 1.65, damage: fast ? 19 : 26 };
}
export function swingConnects(distance: number, angleFromForward: number, reach = 3.7): boolean {
  return distance < reach && Math.cos(angleFromForward) > Math.cos(Math.PI * 0.36);
}
export function swordDamage(kind: string, mode: string): { amount: number; glancing: boolean } {
  if (mode === 'hurt') return { amount: 36, glancing: false };
  if (mode === 'recover') return { amount: SWORD_DAMAGE, glancing: false };
  return { amount: kind === 'thief' ? 15 : 12, glancing: true };
}
