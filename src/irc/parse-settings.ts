import type { LobbyReadyPlayer } from './types.js';

/** Parse trailing Bancho slot mods: `[Hidden]`, `[Hidden, HardRock]`, etc. */
export function parseSlotMods(line: string): string[] {
  const bracket = line.match(/\[([^\]]+)\]\s*$/);
  if (!bracket?.[1]) return [];
  const inner = bracket[1].trim();
  if (!inner || /^none$/i.test(inner) || /^no\s*mod/i.test(inner)) return [];
  if (/^freemod$/i.test(inner)) return [];
  return inner
    .split(/[,/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Parse Bancho `!mp settings` style lines into ready slots (+ mods). */
export function parseMpSettingsReady(raw: string): LobbyReadyPlayer[] {
  const players: LobbyReadyPlayer[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const slotMatch = line.match(/Slot\s+(\d+)\s+(Ready|Not Ready)\s+https?:\/\/osu\.ppy\.sh\/u\/(\d+)\s+(\S+)/i)
      ?? line.match(/^\s*(\d+)\s+(Ready|Not Ready)\s+https?:\/\/osu\.ppy\.sh\/u\/(\d+)\s+(\S+)/i);
    if (!slotMatch) continue;
    const slot = Number(slotMatch[1]);
    let team: 'red' | 'blue' | undefined;
    if (/Team\s*Red|\[Red\]/i.test(line)) team = 'red';
    else if (/Team\s*Blue|\[Blue\]/i.test(line)) team = 'blue';
    else if (slot >= 1 && slot <= 8) team = 'red';
    else if (slot >= 9 && slot <= 16) team = 'blue';
    players.push({
      slot,
      ready: slotMatch[2]!.toLowerCase() === 'ready',
      osuId: slotMatch[3]!,
      username: slotMatch[4],
      team,
      mods: parseSlotMods(line),
    });
  }
  return players;
}
