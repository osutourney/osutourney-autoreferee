export type ParsedRefereeChat =
  | { kind: 'si' }
  | { kind: 'no' }
  | { kind: 'continue' }
  | { kind: 'start' }
  | { kind: 'roll' }
  | { kind: 'tb_yes' }
  | { kind: 'tb_no' }
  | { kind: 'protect' | 'ban' | 'pick'; slot: string }
  | { kind: 'choice'; choice: 'first_protect_ban' | 'first_ban' | 'first_pick' }
  | { kind: 'bancho_roll'; user: string; value: number }
  | { kind: 'unknown'; raw: string };

/** BanchoBot: `Username rolled 42 point(s)` */
export function parseBanchoRoll(message: string): { user: string; value: number } | undefined {
  const match = message.match(/^(.+?)\s+rolled\s+(\d+)\s+points?/i);
  if (!match) return undefined;
  return { user: match[1]!.trim(), value: Number(match[2]) };
}

export function parseRefereeChat(message: string): ParsedRefereeChat {
  const text = message.trim();
  if (!text) return { kind: 'unknown', raw: message };
  const lower = text.toLowerCase();

  const banchoRoll = parseBanchoRoll(text);
  if (banchoRoll) return { kind: 'bancho_roll', user: banchoRoll.user, value: banchoRoll.value };

  if (lower === '!si' || lower === '!yes' || lower === 'si' || lower === 'yes') return { kind: 'si' };
  if (lower === '!no' || lower === 'no') return { kind: 'no' };
  if (lower === '!continue' || lower === '!go') return { kind: 'continue' };
  if (lower === '!start' || lower === 'all ready') return { kind: 'start' };
  if (lower === '!roll' || lower === 'roll') return { kind: 'roll' };
  if (lower === '!tb' || lower === '!tb yes' || lower === 'tb yes') return { kind: 'tb_yes' };
  if (lower === '!tb no' || lower === 'tb no') return { kind: 'tb_no' };

  if (lower.includes('first pick')) return { kind: 'choice', choice: 'first_pick' };
  if (lower.includes('first ban') && lower.includes('protect')) {
    return { kind: 'choice', choice: 'first_protect_ban' };
  }
  if (lower.includes('first ban')) return { kind: 'choice', choice: 'first_ban' };
  if (lower.includes('first protect')) return { kind: 'choice', choice: 'first_protect_ban' };

  const mapCmd = text.match(/^!(protect|ban|pick)\s+(\S+)/i);
  if (mapCmd) {
    return {
      kind: mapCmd[1]!.toLowerCase() as 'protect' | 'ban' | 'pick',
      slot: mapCmd[2]!,
    };
  }

  // bare slot token during draft (captain shorthand)
  if (/^[A-Za-z]{1,3}\d+$/i.test(text)) {
    return { kind: 'pick', slot: text.toUpperCase() };
  }

  return { kind: 'unknown', raw: message };
}
