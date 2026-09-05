import { isHouseGrounds } from './scene-layout.ts';

/** The shared exterior's front-to-rear axis is east; interiors use -Z as north. */
export function compassBearing(room: string, yaw: number): number {
  const northOffset = isHouseGrounds(room) ? 90 : 0;
  return ((northOffset - yaw * 180 / Math.PI) % 360 + 360) % 360;
}

/** Correct the displayed bearing in old journals without changing their saved text. */
export function compassJournalText(entry: { id: string; text: string }): string {
  return entry.id === 'last_road'
    ? entry.text.replace('southwest of the white house', 'northwest of the white house')
    : entry.text;
}
