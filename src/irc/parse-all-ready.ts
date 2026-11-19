/** BanchoBot: everyone in the lobby clicked Ready. */
export function isAllPlayersReadyMessage(message: string): boolean {
  return /all players are ready/i.test(message);
}
