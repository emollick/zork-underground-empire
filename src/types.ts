export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type RoomKind = 'forest' | 'house' | 'cellar' | 'bridge' | 'gallery' | 'rotunda' | 'maze' | 'cyclops' | 'treasury' | 'dam' | 'reservoir' | 'falls' | 'rainbow' | 'temple' | 'underworld' | 'mine' | 'machine' | 'gas' | 'sand' | 'bat' | 'dome' | 'river' | 'altar' | 'barrow';
export interface ExitDef {
  id: string; to: string; label: string; position: Vec2;
  requires?: string; blocked?: string; district?: string;
  role?: 'passage' | 'water' | 'landing' | 'rainbow' | 'stairs' | 'grating' | 'window' | 'hatch' | 'trail' | 'rope' | 'mirror';
  barrier?: 'rubble' | 'sealed-wall' | 'nailed-door' | 'gate' | 'water' | 'creature' | 'drop';
  /** An object supplies the interaction at this route instead of a second exit hotspot. */
  via?: string;
  /** Local yaw facing out through this threshold; transformed with outdoor districts. */
  yaw?: number;
  /** Local arrival when entering this room through this reciprocal route. */
  arrival?: { position: Vec2; yaw: number };
}
export interface ObjectDef {
  id: string; label: string; type: string; position: Vec3;
  action: string; description?: string; requires?: string; hiddenIf?: string;
  item?: string; treasure?: boolean; district?: string; yaw?: number;
}
export interface EnemyDef { id: string; name: string; kind: 'troll' | 'thief' | 'grue'; position: Vec2; health: number; damage: number; speed: number; }
export interface RoomDef {
  id: string; name: string; subtitle: string; description: string;
  kind: RoomKind; size: Vec2; spawn: Vec2; yaw?: number;
  exits: ExitDef[]; objects: ObjectDef[]; enemy?: EnemyDef;
  dark?: boolean; map: Vec2;
}
export interface ItemDef { id: string; name: string; description: string; treasure?: boolean; }
export interface JournalEntry { id: string; title: string; text: string; }
export interface Settings { volume: number; sensitivity: number; fov: number; quality: 'high' | 'balanced'; motion: boolean; difficulty?: 'explorer' | 'adventurer' | 'veteran'; }
export interface GameState {
  version: number; room: string; position: Vec2; yaw: number;
  health: number; stamina: number; lantern: boolean;
  inventory: string[]; deposited: string[]; flags: Record<string, boolean>;
  visited: string[]; journal: JournalEntry[]; checkpoint: string;
  enemies: Record<string, number>; deaths: number; playTime: number;
  completed: boolean; settings: Settings;
}
export interface ActionResult {
  message: string; title?: string; success: boolean; sound?: string;
  travel?: string; refresh?: boolean; ending?: boolean;
  choices?: { label: string; action: string }[];
  prompt?: { label: string; action: string; submit: string };
  itemSelection?: boolean;
  feedback?: string;
}
export interface Collider { x: number; z: number; w: number; d: number; }
