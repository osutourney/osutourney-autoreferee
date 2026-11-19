/** BanchoBot: `The match has finished!` */
export function isMatchFinishedMessage(message: string): boolean {
  return /the match has finished/i.test(message);
}
