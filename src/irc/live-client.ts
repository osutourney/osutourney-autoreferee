import net from 'node:net';
import { isMatchAbortedMessage, parsePlayerLeft } from './parse-match-abort.js';
import { isMatchFinishedMessage } from './parse-match-finished.js';
import { parseMpCreated } from './parse-mp-created.js';
import { parseMpSettingsReady } from './parse-settings.js';
import type {
  BanchoIrcClient,
  BanchoIrcClientOptions,
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

/**
 * Minimal Bancho IRC client (no BanchoJS).
 * Supports multiparse of PRIVMSG + BanchoBot multiplayer lines enough for auto-ref.
 */
export class LiveBanchoIrcClient implements BanchoIrcClient {
  connected = false;
  readonly fake = false;
  private socket: net.Socket | undefined;
  private buffer = '';
  private username: string;
  private password: string;
  private host: string;
  private port: number;
  private chatHandlers: ChatHandler[] = [];
  private matchHandlers: MatchHandler[] = [];
  private abortHandlers: AbortHandler[] = [];
  private joinHandlers: JoinHandler[] = [];
  private leftHandlers: LeftHandler[] = [];
  private readyCache = new Map<string, Map<string, LobbyReadyPlayer>>();
  private pendingCreate: {
    resolve: (value: { mpId: string; channel: string; url: string }) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | undefined;
  private pendingSettings = new Map<string, {
    chunks: string[];
    resolve: (value: LobbyReadyInspect) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private trackedChannels = new Set<string>();
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private intentionalDisconnect = false;

  constructor(options: BanchoIrcClientOptions) {
    this.username = options.username?.trim() ?? '';
    this.password = options.password?.trim() ?? '';
    this.host = options.host ?? 'irc.ppy.sh';
    this.port = options.port ?? 6667;
  }

  onChat(handler: ChatHandler) { this.chatHandlers.push(handler); }
  onMatchFinished(handler: MatchHandler) { this.matchHandlers.push(handler); }
  onMatchAborted(handler: AbortHandler) { this.abortHandlers.push(handler); }
  onPlayerJoined(handler: JoinHandler) { this.joinHandlers.push(handler); }
  onPlayerLeft(handler: LeftHandler) { this.leftHandlers.push(handler); }

  async connect() {
    if (!this.username || !this.password) {
      throw new Error('BANCHO_USERNAME and BANCHO_PASSWORD required for live IRC');
    }
    this.intentionalDisconnect = false;
    await this.openSocket();
    await this.rejoinTrackedChannels();
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this.socket = socket;
        this.writeRaw(`PASS ${this.password}`);
        this.writeRaw(`NICK ${this.username}`);
        this.writeRaw(`USER ${this.username} 0 * :${this.username}`);
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => this.onData(String(chunk)));
      socket.on('error', (err) => {
        if (!this.connected) reject(err);
      });
      socket.on('close', () => {
        this.connected = false;
        this.socket = undefined;
        if (!this.intentionalDisconnect) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalDisconnect) return;
    const attempt = this.reconnectAttempts++;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openSocket()
        .then(() => this.rejoinTrackedChannels())
        .catch(() => this.scheduleReconnect());
    }, delayMs);
  }

  private async rejoinTrackedChannels() {
    for (const channel of this.trackedChannels) {
      this.writeRaw(`JOIN ${channel}`);
    }
  }

  async joinChannel(channel: string) {
    const key = channel.startsWith('#') ? channel : `#${channel}`;
    this.trackedChannels.add(key);
    if (this.connected) this.writeRaw(`JOIN ${key}`);
  }

  async disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      this.writeRaw('QUIT :bye');
      this.socket.destroy();
    }
    this.connected = false;
    this.socket = undefined;
  }

  private writeRaw(line: string) {
    this.socket?.write(`${line}\r\n`);
  }

  private channelSend(channel: string, content: string) {
    if (!this.connected) throw new Error('bancho_not_connected');
    this.writeRaw(`PRIVMSG ${channel} :${content}`);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? '';
    for (const line of parts) {
      if (!line) continue;
      if (line.startsWith('PING ')) {
        this.writeRaw(`PONG ${line.slice(5)}`);
        continue;
      }
      this.handleLine(line);
    }
  }

  /** BanchoBot confirms `!mp make` via PM/NOTICE (body or full IRC line). */
  private tryResolveCreate(text: string) {
    if (!this.pendingCreate) return false;
    const created = parseMpCreated(text);
    if (!created) return false;
    clearTimeout(this.pendingCreate.timer);
    const resolve = this.pendingCreate.resolve;
    this.pendingCreate = undefined;
    // Ensure we are in the lobby channel for later !mp * / events.
    this.trackedChannels.add(created.channel);
    this.writeRaw(`JOIN ${created.channel}`);
    resolve(created);
    return true;
  }

  private handleLine(line: string) {
    // NOTICE (BanchoBot sometimes uses this for match created)
    const notice = line.match(/^:(\S+?)(?:!\S+)? NOTICE (\S+) :(.+)$/i);
    if (notice) {
      this.tryResolveCreate(notice[3]!);
      return;
    }

    // :BanchoBot!cho@ppy.sh PRIVMSG #mp_1 :...  OR  PRIVMSG lehenna :Created ... mp/123
    const priv = line.match(/^:(\S+?)(?:!(\S+))? PRIVMSG (\S+) :(.+)$/i);
    if (!priv) {
      this.tryResolveCreate(line);
      return;
    }
    const nick = priv[1]!.split('!')[0]!;
    const channel = priv[3]!;
    const message = priv[4]!;

    // `!mp make` ack is a PM to the IRC nick with the osu.ppy.sh/mp/ URL.
    if (this.tryResolveCreate(message)) {
      return;
    }

    const pending = this.pendingSettings.get(channel);
    if (pending && (/Slot\s+\d+/i.test(message) || nick.toLowerCase() === 'banchobot')) {
      pending.chunks.push(message);
      clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        const joined = pending.chunks.join('\n');
        const players = parseMpSettingsReady(joined);
        this.pendingSettings.delete(channel);
        pending.resolve({
          players: players.length ? players : [...(this.readyCache.get(channel)?.values() ?? [])],
          raw: joined,
        });
      }, 300);
    }

    if (/joined in slot/i.test(message)) {
      const join = message.match(/(.+?)\s+joined in slot\s+(\d+)/i);
      if (join) {
        const username = join[1]!.trim();
        const slot = Number(join[2]);
        const mpId = channel.replace(/^#mp_/, '');
        void Promise.all(this.joinHandlers.map((handler) => handler({
          channel,
          mpId,
          osuId: username,
          username,
          ready: false,
        })));
        const map = this.readyCache.get(channel) ?? new Map();
        map.set(username, { osuId: username, username, ready: false, slot });
        this.readyCache.set(channel, map);
      }
    }

    // `Name changed to Ready` / `Not Ready`
    const readyChange = message.match(/^(.+?)\s+changed to\s+(Ready|Not Ready)\b/i);
    if (readyChange) {
      const username = readyChange[1]!.trim();
      const ready = readyChange[2]!.toLowerCase() === 'ready';
      const map = this.readyCache.get(channel) ?? new Map();
      const prev = [...map.values()].find((row) =>
        row.username?.toLowerCase() === username.toLowerCase()
        || row.osuId.toLowerCase() === username.toLowerCase());
      const key = prev?.osuId ?? username;
      map.set(key, {
        osuId: key,
        username: prev?.username ?? username,
        ready,
        slot: prev?.slot,
        team: prev?.team,
      });
      this.readyCache.set(channel, map);
    }

    const leftName = parsePlayerLeft(message);
    if (leftName) {
      const mpId = channel.replace(/^#mp_/, '');
      const map = this.readyCache.get(channel);
      map?.delete(leftName);
      for (const [key, row] of map ?? []) {
        if (row.username?.toLowerCase() === leftName.toLowerCase()) map?.delete(key);
      }
      void Promise.all(this.leftHandlers.map((handler) => handler({
        channel,
        mpId,
        osuId: leftName,
        username: leftName,
      })));
    }

    if (nick.toLowerCase() === 'banchobot' && isMatchAbortedMessage(message)) {
      const mpId = channel.replace(/^#mp_/, '');
      void Promise.all(this.abortHandlers.map((handler) => handler({ channel, mpId })));
    } else if (nick.toLowerCase() === 'banchobot' && isMatchFinishedMessage(message)) {
      const mpId = channel.replace(/^#mp_/, '');
      void Promise.all(this.matchHandlers.map((handler) => handler({
        channel,
        mpId,
        scores: [],
      })));
    }

    void Promise.all(this.chatHandlers.map((handler) => handler({ channel, user: nick, message })));
  }

  async createMultiLobby(name: string) {
    if (!this.connected) throw new Error('bancho_not_connected');
    return new Promise<{ mpId: string; channel: string; url: string }>((resolve, reject) => {
      if (this.pendingCreate) {
        clearTimeout(this.pendingCreate.timer);
        this.pendingCreate.reject(new Error('create_superseded'));
      }
      const timer = setTimeout(() => {
        this.pendingCreate = undefined;
        reject(new Error('create_lobby_timeout'));
      }, 20_000);
      this.pendingCreate = { resolve, reject, timer };
      // Prefer `!mp make` via BanchoBot PM; response is also a PM with the mp link.
      this.writeRaw(`PRIVMSG BanchoBot :!mp make ${name}`);
    });
  }

  async invitePlayer(channel: string, target: string) {
    this.channelSend(channel, `!mp invite ${target}`);
  }

  async addref(channel: string, target: string) {
    this.channelSend(channel, `!mp addref ${target}`);
  }

  async setMap(channel: string, beatmapId: string, mods: string[] = []) {
    // Bancho: map id and mods are separate commands (`!mp map` mode arg ≠ mods).
    this.channelSend(channel, `!mp map ${beatmapId}`);
    const normalized = mods
      .map((mod) => mod.replace(/^\+/, '').trim())
      .filter(Boolean);
    const freemod = normalized.some((mod) => /^freemod$/i.test(mod) || /^fm$/i.test(mod));
    if (freemod) {
      this.channelSend(channel, '!mp mods Freemod');
    } else if (normalized.length) {
      this.channelSend(channel, `!mp mods ${normalized.join(' ')}`);
    } else {
      this.channelSend(channel, '!mp mods None');
    }
  }

  async startMatch(channel: string, _countdownSec = 5) {
    // Always `!mp start 5` — Bancho countdown before map.
    this.channelSend(channel, '!mp start 5');
  }

  async mpAbort(channel: string) {
    this.channelSend(channel, '!mp abort');
  }

  async closeLobby(channel: string) {
    this.channelSend(channel, '!mp close');
    this.readyCache.delete(channel);
    this.trackedChannels.delete(channel);
  }

  async sendMessage(channel: string, content: string) {
    this.channelSend(channel, content);
  }

  async setSize(channel: string, size: number) {
    this.channelSend(channel, `!mp size ${size}`);
  }

  async mpSet(channel: string, args: string) {
    this.channelSend(channel, `!mp set ${args}`);
  }

  async mpTimer(channel: string, seconds: number) {
    this.channelSend(channel, `!mp timer ${seconds}`);
  }

  async mpAbortTimer(channel: string) {
    this.channelSend(channel, '!mp aborttimer');
  }

  async mpHost(channel: string, username: string) {
    this.channelSend(channel, `!mp host ${username}`);
  }

  async mpClearHost(channel: string) {
    this.channelSend(channel, '!mp clearhost');
  }

  async inspectLobbyReady(channel: string): Promise<LobbyReadyInspect> {
    const existing = this.pendingSettings.get(channel);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error('inspect_superseded'));
      this.pendingSettings.delete(channel);
    }
    const result = new Promise<LobbyReadyInspect>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSettings.delete(channel);
        const cached = [...(this.readyCache.get(channel)?.values() ?? [])];
        if (cached.length) resolve({ players: cached, raw: '' });
        else reject(new Error('inspect_ready_timeout'));
      }, 4_000);
      this.pendingSettings.set(channel, { chunks: [], resolve, reject, timer });
    });
    this.channelSend(channel, '!mp settings');
    return result;
  }
}
