/** BanchoBot / referee: match was aborted (not a scored finish). */
export function isMatchAbortedMessage(message: string): boolean {
  return /aborted the match/i.test(message)
    || /the match (?:has been )?aborted/i.test(message)
    || /^Aborted!?\s*$/i.test(message.trim());
}

/** BanchoBot: player left the multi lobby. */
export function parsePlayerLeft(message: string): string | undefined {
  const match = message.match(/^(.+?)\s+left the (?:game|match)\.?$/i)
    ?? message.match(/^(.+?)\s+left the lobby\.?$/i);
  return match?.[1]?.trim();
}
