import type { GameState } from './types.ts';
import { ROOMS } from './campaign.ts';

// Verbatim from the MIT-licensed Zork I gverbs.zil and gglobals.zil.
export const GRUE_WARNING = 'It is pitch black. You are likely to be eaten by a grue.';
export const GRUE_DEATH = 'Oh, no! You have walked into the slavering fangs of a lurking grue!';
export const GRUE_DESCRIPTION = 'The grue is a sinister, lurking presence in the dark places of the earth. Its favorite diet is adventurers, but its insatiable appetite is tempered by its fear of light. No grue has ever been seen by the light of day, and few have survived its fearsome jaws to tell the tale.';

export function carriesLight(state: GameState): boolean {
  return state.inventory.includes('torch') || state.lantern && state.inventory.includes('lantern');
}

export function hasLight(state: GameState): boolean {
  if (carriesLight(state)) return true;
  return ROOMS[state.room].objects.some(object => object.type === 'torch'
    && !(object.hiddenIf && state.flags[object.hiddenIf]) && (!object.requires || state.flags[object.requires])
    && Math.hypot(object.position[0] - state.position[0], object.position[2] - state.position[1]) < 3.2);
}

export function grueTiming(state: GameState): { grace: number; damage: number; interval: number } {
  const difficulty = state.settings.difficulty ?? 'adventurer';
  return difficulty === 'explorer' ? { grace: 16, damage: 20, interval: 3.2 }
    : difficulty === 'veteran' ? { grace: 10, damage: 40, interval: 2.8 }
      : { grace: 12, damage: 30, interval: 3 };
}
