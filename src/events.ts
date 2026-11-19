import type { DraftSide, RefereePhase, RefereeStateSnapshot } from './referee/types.js';

export type LobbyCreatedEvent = {
  mpId: string;
  channel: string;
  url: string;
  lobbyName: string;
};

export type RefereeEventMap = {
  state: RefereeStateSnapshot;
  phase: { phase: RefereePhase; detail?: string };
  chat: { channel: string; user: string; message: string };
  lobby_created: LobbyCreatedEvent;
  announce: { message: string };
  /** Bancho map ended — host should fetch osu API and `score.apply`. */
  map_finished: {
    mpId: string;
    channel?: string;
    slot?: string;
    beatmapId?: string;
    disconnectedOsuIds: string[];
    /** IRC-provided scores when available (usually empty on live Bancho). */
    ircScores: Array<{
      osuId: string;
      score: number;
      team?: string;
      username?: string;
      mods?: string[];
    }>;
  };
  score: {
    red: number;
    blue: number;
    mapScores?: Array<{
      osuId: string;
      /** Adjusted score (multipliers applied). */
      score: number;
      rawScore?: number;
      mods?: string[];
      team?: string;
      username?: string;
      disconnected?: boolean;
    }>;
    slot?: string;
    beatmapId?: string;
  };
  forfeit: { side?: DraftSide; both?: boolean; reason: string };
  abort: {
    reason: string;
    abortsThisMap: number;
    maxAbortsPerMap: number;
    byBot: boolean;
  };
  finished: {
    winner?: DraftSide;
    score: { red: number; blue: number };
    reason: string;
  };
  error: { message: string; cause?: unknown };
};

export type RefereeEventName = keyof RefereeEventMap;

export type RefereeListener<K extends RefereeEventName> = (payload: RefereeEventMap[K]) => void;

export class RefereeEmitter {
  private listeners = new Map<RefereeEventName, Set<RefereeListener<RefereeEventName>>>();

  on<K extends RefereeEventName>(event: K, listener: RefereeListener<K>) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as RefereeListener<RefereeEventName>);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends RefereeEventName>(event: K, listener: RefereeListener<K>) {
    this.listeners.get(event)?.delete(listener as RefereeListener<RefereeEventName>);
  }

  emit<K extends RefereeEventName>(event: K, payload: RefereeEventMap[K]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}
