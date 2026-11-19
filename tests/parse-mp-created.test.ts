import { describe, expect, it } from 'vitest';
import { parseMpCreated } from '../src/irc/parse-mp-created.js';

describe('parseMpCreated', () => {
  it('parses BanchoBot create ack with lobby name suffix', () => {
    const text =
      'Created the tournament match https://osu.ppy.sh/mp/122140781 DEMO: (Lobby 2) vs (Qualifiers)';
    expect(parseMpCreated(text)).toEqual({
      mpId: '122140781',
      channel: '#mp_122140781',
      url: 'https://osu.ppy.sh/mp/122140781',
    });
  });

  it('parses from a full PRIVMSG line body', () => {
    const line =
      ':BanchoBot!cho@ppy.sh PRIVMSG lehenna :Created the tournament match https://osu.ppy.sh/mp/122140781 AR-SMOKE: lehenna qual';
    const body = line.split(' :').slice(1).join(' :');
    expect(parseMpCreated(body)?.mpId).toBe('122140781');
  });
});
