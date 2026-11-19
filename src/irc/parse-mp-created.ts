/**
 * Parse BanchoBot lobby-create ack, e.g.
 * `Created the tournament match https://osu.ppy.sh/mp/122140781 DEMO: (Lobby 2) vs (Qualifiers)`
 */
export function parseMpCreated(text: string): { mpId: string; channel: string; url: string } | undefined {
  const match = text.match(
    /Created the tournament match\s+https:\/\/osu\.ppy\.sh\/mp\/(\d+)/i,
  ) ?? text.match(/https:\/\/osu\.ppy\.sh\/mp\/(\d+)/i)
    ?? text.match(/#mp_(\d+)/i);
  const mpId = match?.[1];
  if (!mpId) return undefined;
  return {
    mpId,
    channel: `#mp_${mpId}`,
    url: `https://osu.ppy.sh/mp/${mpId}`,
  };
}
