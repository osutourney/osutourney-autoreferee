import { FakeBanchoIrcClient } from './fake-client.js';
import { LiveBanchoIrcClient } from './live-client.js';
import type { BanchoIrcClient, BanchoIrcClientOptions } from './types.js';

export async function createBanchoIrcClient(
  options: BanchoIrcClientOptions = {},
): Promise<BanchoIrcClient> {
  const fake = options.fake === true
    || !options.username?.trim()
    || !options.password?.trim();
  const client = fake
    ? new FakeBanchoIrcClient()
    : new LiveBanchoIrcClient(options);
  await client.connect();
  return client;
}

export type { BanchoIrcClient, BanchoIrcClientOptions };
