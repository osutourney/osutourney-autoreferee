export type LobbyReadyPlayer = {
  osuId: string;
  username?: string;
  ready: boolean;
  slot?: number;
  team?: 'red' | 'blue' | string;
  /** Player-selected mods from `!mp settings` (freemod). */
  mods?: string[];
};

export type LobbyReadyInspect = {
  players: LobbyReadyPlayer[];
  raw?: string;
};

export type BanchoIrcClientOptions = {
  username?: string;
  password?: string;
  /** Use in-memory fake Bancho (tests / local smoke). */
  fake?: boolean;
  host?: string;
  port?: number;
};

export type BanchoIrcClient = {
  readonly connected: boolean;
  readonly fake: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** JOIN an existing `#mp_*` channel (failover reattach). */
  joinChannel(channel: string): Promise<void>;
  createMultiLobby(name: string): Promise<{ mpId: string; channel: string; url: string }>;
  invitePlayer(channel: string, target: string): Promise<void>;
  addref(channel: string, target: string): Promise<void>;
  setMap(channel: string, beatmapId: string, mods?: string[]): Promise<void>;
  /** Always sends `!mp start 5` (countdownSec ignored; kept for API stability). */
  startMatch(channel: string, countdownSec?: number): Promise<void>;
  /** Abort the current map (`!mp abort`) — not a scored finish. */
  mpAbort(channel: string): Promise<void>;
  closeLobby(channel: string): Promise<void>;
  sendMessage(channel: string, content: string): Promise<void>;
  setSize(channel: string, size: number): Promise<void>;
  /** Raw `!mp set` args (teammode, scoremode, etc.). */
  mpSet(channel: string, args: string): Promise<void>;
  mpTimer(channel: string, seconds: number): Promise<void>;
  mpAbortTimer(channel: string): Promise<void>;
  mpHost(channel: string, username: string): Promise<void>;
  mpClearHost(channel: string): Promise<void>;
  inspectLobbyReady(channel: string): Promise<LobbyReadyInspect>;
  onChat(handler: (event: { channel: string; user: string; message: string }) => void | Promise<void>): void;
  onMatchFinished(handler: (event: {
    channel: string;
    mpId: string;
    scores: Array<{ osuId: string; username?: string; score: number; team?: string; mods?: string[] }>;
  }) => void | Promise<void>): void;
  onMatchAborted(handler: (event: {
    channel: string;
    mpId: string;
  }) => void | Promise<void>): void;
  onPlayerJoined(handler: (event: {
    channel: string;
    mpId: string;
    osuId: string;
    username?: string;
    ready?: boolean;
  }) => void | Promise<void>): void;
  onPlayerLeft(handler: (event: {
    channel: string;
    mpId: string;
    osuId: string;
    username?: string;
  }) => void | Promise<void>): void;
};
