import type {
  BanchoIrcClient,
  LobbyReadyInspect,
  LobbyReadyPlayer,
} from './types.js';

type ChatHandler = (event: { channel: string; user: string; message: string }) => void | Promise<void>;
type MatchHandler = (event: {
  channel: string;
  mpId: string;
  scores: Array<{ osuId: string; username?: string; score: number; team?: string }>;
}) => void | Promise<void>;
type AbortHandler = (event: { channel: string; mpId: string }) => void | Promise<void>;
type JoinHandler = (event: {
  channel: string;
  mpId: string;
  osuId: string;
  username?: string;
  ready?: boolean;
}) => void | Promise<void>;
type LeftHandler = (event: {
  channel: string;
  mpId: string;
  osuId: string;
  username?: string;
}) => void | Promise<void>;

/** In-memory Bancho for tests and local smoke (`fake: true`). */
export class FakeBanchoIrcClient implements BanchoIrcClient {
  connected = false;
  readonly fake = true;
  invites: Array<{ channel: string; target: string }> = [];
  addrefs: Array<{ channel: string; target: string }> = [];
  messages: Array<{ channel: string; content: string }> = [];
  maps: Array<{ channel: string; beatmapId: string; mods?: string[] }> = [];
  commands: string[] = [];
  private mpCounter = 1000;
  private slots = new Map<string, Map<string, LobbyReadyPlayer>>();
  private chatHandlers: ChatHandler[] = [];
  private matchHandlers: MatchHandler[] = [];
  private abortHandlers: AbortHandler[] = [];
  private joinHandlers: JoinHandler[] = [];
  private leftHandlers: LeftHandler[] = [];

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  async joinChannel(channel: string) {
    this.slotsFor(channel);
  }

  onChat(handler: ChatHandler) { this.chatHandlers.push(handler); }
  onMatchFinished(handler: MatchHandler) { this.matchHandlers.push(handler); }
  onMatchAborted(handler: AbortHandler) { this.abortHandlers.push(handler); }
  onPlayerJoined(handler: JoinHandler) { this.joinHandlers.push(handler); }
  onPlayerLeft(handler: LeftHandler) { this.leftHandlers.push(handler); }

  private slotsFor(channel: string) {
    const key = channel.startsWith('#') ? channel : `#mp_${channel}`;
    let map = this.slots.get(key);
    if (!map) {
      map = new Map();
      this.slots.set(key, map);
    }
    return map;
  }

  setPlayerReady(
    channel: string,
    osuId: string,
    ready: boolean,
    username?: string,
    slot?: number,
    team?: string,
    mods?: string[],
  ) {
    const map = this.slotsFor(channel);
    const prev = map.get(osuId);
    map.set(osuId, {
      osuId,
      username: username ?? prev?.username,
      ready,
      slot: slot ?? prev?.slot ?? map.size,
      team: team ?? prev?.team,
      mods: mods ?? prev?.mods ?? [],
    });
  }

  async emitChat(channel: string, user: string, message: string) {
    for (const handler of this.chatHandlers) await handler({ channel, user, message });
  }

  async emitMatchFinished(
    channel: string,
    mpId: string,
    scores: Array<{ osuId: string; score: number; team?: string; username?: string; mods?: string[] }>,
  ) {
    for (const handler of this.matchHandlers) await handler({ channel, mpId, scores });
  }

  async emitPlayerJoined(channel: string, mpId: string, osuId: string, ready = false, username?: string) {
    this.setPlayerReady(channel, osuId, ready, username);
    for (const handler of this.joinHandlers) {
      await handler({ channel, mpId, osuId, username, ready });
    }
  }

  async emitPlayerLeft(channel: string, mpId: string, osuId: string, username?: string) {
    this.slotsFor(channel).delete(osuId);
    for (const handler of this.leftHandlers) {
      await handler({ channel, mpId, osuId, username: username ?? osuId });
    }
  }

  async emitMatchAborted(channel: string, mpId: string) {
    for (const handler of this.abortHandlers) await handler({ channel, mpId });
  }

  async createMultiLobby(name: string) {
    if (!this.connected) throw new Error('bancho_not_connected');
    void name;
    const mpId = String(++this.mpCounter);
    const channel = `#mp_${mpId}`;
    this.slotsFor(channel);
    return { mpId, channel, url: `https://osu.ppy.sh/mp/${mpId}` };
  }

  async invitePlayer(channel: string, target: string) {
    if (!this.connected) throw new Error('bancho_not_connected');
    this.invites.push({ channel, target });
    this.commands.push(`!mp invite ${target}`);
  }

  async addref(channel: string, target: string) {
    if (!this.connected) throw new Error('bancho_not_connected');
    this.addrefs.push({ channel, target });
    this.commands.push(`!mp addref ${target}`);
  }

  async setMap(channel: string, beatmapId: string, mods: string[] = []) {
    this.maps.push({ channel, beatmapId, mods });
    this.commands.push(`!mp map ${beatmapId}`);
    const normalized = mods.map((mod) => mod.replace(/^\+/, '').trim()).filter(Boolean);
    const freemod = normalized.some((mod) => /^freemod$/i.test(mod) || /^fm$/i.test(mod));
    if (freemod) this.commands.push('!mp mods Freemod');
    else if (normalized.length) this.commands.push(`!mp mods ${normalized.join(' ')}`);
    else this.commands.push('!mp mods None');
  }

  async startMatch(_channel: string, _countdownSec = 5) {
    this.commands.push('!mp start 5');
  }

  async mpAbort(_channel: string) {
    this.commands.push('!mp abort');
  }

  async closeLobby(channel: string) {
    this.commands.push('!mp close');
    this.slots.delete(channel);
  }

  async sendMessage(channel: string, content: string) {
    this.messages.push({ channel, content });
  }

  async setSize(channel: string, size: number) {
    void channel;
    this.commands.push(`!mp size ${size}`);
  }

  async mpSet(channel: string, args: string) {
    void channel;
    this.commands.push(`!mp set ${args}`);
  }

  async mpTimer(channel: string, seconds: number) {
    void channel;
    this.commands.push(`!mp timer ${seconds}`);
  }

  async mpAbortTimer(channel: string) {
    void channel;
    this.commands.push('!mp aborttimer');
  }

  async mpHost(channel: string, username: string) {
    void channel;
    this.commands.push(`!mp host ${username}`);
  }

  async mpClearHost(channel: string) {
    void channel;
    this.commands.push('!mp clearhost');
  }

  async inspectLobbyReady(channel: string): Promise<LobbyReadyInspect> {
    if (!this.connected) throw new Error('bancho_not_connected');
    return { players: [...this.slotsFor(channel).values()] };
  }
}
