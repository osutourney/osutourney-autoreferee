import { describe, expect, it } from 'vitest';
import { createLobbyCapacityGate } from '../src/referee/capacity.js';

describe('capacity gate', () => {
  it('limits concurrent and queues', () => {
    const gate = createLobbyCapacityGate(2);
    expect(gate.acquire('a')).toEqual({ ok: true });
    expect(gate.acquire('b')).toEqual({ ok: true });
    expect(gate.acquire('c')).toMatchObject({ ok: false, queued: true, position: 1 });
    gate.release('a');
    expect(gate.activeCount()).toBe(2);
  });
});
