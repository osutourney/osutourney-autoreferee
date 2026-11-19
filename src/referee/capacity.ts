export type CapacityAcquireResult =
  | { ok: true }
  | { ok: false; queued: true; position: number };

export type LobbyCapacityGate = {
  maxConcurrent: number;
  acquire(lobbyKey: string): CapacityAcquireResult | Promise<CapacityAcquireResult>;
  release(lobbyKey: string): void | Promise<void>;
  activeCount(): number;
  queueLength(): number;
};

/** In-memory FIFO capacity gate (default max 4; host may use Redis later). */
export function createLobbyCapacityGate(maxConcurrent = 4): LobbyCapacityGate {
  const active = new Set<string>();
  const queue: string[] = [];
  const waiters = new Map<string, {
    resolve: (value: CapacityAcquireResult) => void;
  }>();

  const tryPromote = () => {
    while (active.size < maxConcurrent && queue.length) {
      const next = queue.shift()!;
      active.add(next);
      const waiter = waiters.get(next);
      waiters.delete(next);
      waiter?.resolve({ ok: true });
    }
  };

  return {
    maxConcurrent,
    acquire(lobbyKey) {
      if (active.has(lobbyKey)) return { ok: true };
      if (active.size < maxConcurrent) {
        active.add(lobbyKey);
        return { ok: true };
      }
      if (!queue.includes(lobbyKey)) queue.push(lobbyKey);
      return {
        ok: false,
        queued: true,
        position: queue.indexOf(lobbyKey) + 1,
      };
    },
    release(lobbyKey) {
      active.delete(lobbyKey);
      const idx = queue.indexOf(lobbyKey);
      if (idx >= 0) queue.splice(idx, 1);
      waiters.delete(lobbyKey);
      tryPromote();
    },
    activeCount() { return active.size; },
    queueLength() { return queue.length; },
  };
}

/** Promise that resolves when capacity is acquired (polls gate for queued keys). */
export async function waitForCapacity(
  gate: LobbyCapacityGate,
  lobbyKey: string,
  pollMs = 250,
): Promise<void> {
  for (;;) {
    const result = await gate.acquire(lobbyKey);
    if (result.ok) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
