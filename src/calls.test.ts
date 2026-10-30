import { describe, expect, it } from 'vitest';
import { advanceScheduledCalls, formatCountdown, makeScheduledCall, readScheduledCalls, upsertScheduledCall, writeScheduledCalls } from './calls';

const base = Date.parse('2026-10-30T12:00:00.000Z');
const call = (at: number, prep = 5) => makeScheduledCall({ id: 'task-1', taskId: 'task-1', title: 'Study', callAt: new Date(at).toISOString(), preparationMinutes: prep }, base);

describe('scheduled Calls', () => {
  it('waits until preparation time, then sends one prep reminder and one Call', () => {
    const scheduled = call(base + 10 * 60_000);
    const before = advanceScheduledCalls([scheduled], base + 4 * 60_000);
    expect(before.actions).toHaveLength(0);
    const prep = advanceScheduledCalls(before.calls, base + 5 * 60_000);
    expect(prep.actions.map(action => action.kind)).toEqual(['preparation']);
    const duplicatePrep = advanceScheduledCalls(prep.calls, base + 6 * 60_000);
    expect(duplicatePrep.actions).toHaveLength(0);
    const due = advanceScheduledCalls(duplicatePrep.calls, base + 10 * 60_000);
    expect(due.actions.map(action => action.kind)).toEqual(['call']);
    expect(due.calls[0].status).toBe('delivered');
    expect(advanceScheduledCalls(due.calls, base + 11 * 60_000).actions).toHaveLength(0);
  });

  it('delivers a due Call only once, including on a subsequent scheduler pass', () => {
    const scheduled = call(base + 10_000, 0);
    const first = advanceScheduledCalls([scheduled], base + 10_000);
    expect(first.actions.map(action => action.kind)).toEqual(['call']);
    const afterRefresh = advanceScheduledCalls(first.calls, base + 20_000);
    expect(afterRefresh.actions).toHaveLength(0);
  });

  it('persists delivery before a refresh so the same Call cannot be claimed twice', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    writeScheduledCalls([call(base + 10_000, 0)], storage);
    const first = advanceScheduledCalls(readScheduledCalls(storage), base + 10_000);
    expect(first.actions.map(action => action.kind)).toEqual(['call']);
    writeScheduledCalls(first.calls, storage);
    const afterRefresh = advanceScheduledCalls(readScheduledCalls(storage), base + 20_000);
    expect(afterRefresh.actions).toHaveLength(0);
  });

  it('marks an old Call missed instead of interrupting with a stale alert', () => {
    const scheduled = call(base);
    const result = advanceScheduledCalls([scheduled], base + 31 * 60_000);
    expect(result.actions.map(action => action.kind)).toEqual(['missed']);
    expect(result.calls[0].status).toBe('missed');
    expect(advanceScheduledCalls(result.calls, base + 32 * 60_000).actions).toHaveLength(0);
  });

  it('does not consume a Call while permission is denied, then sends it if permission is granted in time', () => {
    const scheduled = call(base + 10_000, 0);
    const blocked = advanceScheduledCalls([scheduled], base + 10_000, undefined, false);
    expect(blocked.actions).toHaveLength(0);
    expect(blocked.calls[0].status).toBe('scheduled');
    const grantedLater = advanceScheduledCalls(blocked.calls, base + 20_000, undefined, true);
    expect(grantedLater.actions.map(action => action.kind)).toEqual(['call']);
  });

  it('rescheduling replaces a previous schedule and countdowns use the scheduled instant', () => {
    const original = call(base + 60_000);
    const replacement = makeScheduledCall({ id: 'task-1', taskId: 'task-1', title: 'Study', callAt: new Date(base + 120_000).toISOString(), preparationMinutes: 0 }, base);
    expect(upsertScheduledCall([original], replacement)).toEqual([replacement]);
    expect(formatCountdown(replacement.callAt, base)).toBe('2m 0s');
  });
});
