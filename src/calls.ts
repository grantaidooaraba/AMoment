export const SCHEDULED_CALLS_KEY = 'amoment-scheduled-calls';
export const MISSED_CALL_GRACE_MS = 30 * 60 * 1000;

export type ScheduledCallStatus = 'scheduled' | 'delivered' | 'missed' | 'cancelled';
export type ScheduledCall = {
  id: string;
  taskId: string;
  title: string;
  firstAction?: string;
  callAt: string;
  timezone: string;
  preparationMinutes: number;
  preparationSentAt: string | null;
  callSentAt: string | null;
  status: ScheduledCallStatus;
  createdAt: string;
  test?: boolean;
};
export type CallAction = { kind: 'preparation' | 'call' | 'missed'; call: ScheduledCall; lateByMs: number };

export function makeScheduledCall(input: {
  id: string;
  taskId: string;
  title: string;
  firstAction?: string;
  callAt: string;
  preparationMinutes?: number;
  test?: boolean;
}, now = Date.now()): ScheduledCall {
  if (!Number.isFinite(Date.parse(input.callAt))) throw new Error('Choose a valid date and time.');
  return {
    id: input.id,
    taskId: input.taskId,
    title: input.title,
    ...(input.firstAction ? { firstAction: input.firstAction } : {}),
    callAt: new Date(input.callAt).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    preparationMinutes: input.preparationMinutes ?? 5,
    preparationSentAt: null,
    callSentAt: null,
    status: 'scheduled',
    createdAt: new Date(now).toISOString(),
    ...(input.test ? { test: true } : {}),
  };
}

export function upsertScheduledCall(calls: ScheduledCall[], next: ScheduledCall): ScheduledCall[] {
  return [...calls.filter(call => call.id !== next.id), next].sort((a, b) => Date.parse(a.callAt) - Date.parse(b.callAt));
}

export function advanceScheduledCalls(
  calls: ScheduledCall[],
  now = Date.now(),
  graceMs = MISSED_CALL_GRACE_MS,
  canNotify = true,
): { calls: ScheduledCall[]; actions: CallAction[] } {
  const actions: CallAction[] = [];
  const nextCalls = calls.map(call => {
    if (call.status !== 'scheduled') return call;
    const dueAt = Date.parse(call.callAt);
    if (!Number.isFinite(dueAt)) return { ...call, status: 'missed' as const };
    const lateByMs = now - dueAt;
    if (lateByMs >= 0) {
      if (lateByMs > graceMs) {
        const missed = { ...call, status: 'missed' as const };
        actions.push({ kind: 'missed', call: missed, lateByMs });
        return missed;
      }
      if (!canNotify) return call;
      const delivered = { ...call, status: 'delivered' as const, callSentAt: new Date(now).toISOString() };
      actions.push({ kind: 'call', call: delivered, lateByMs });
      return delivered;
    }
    const preparationAt = dueAt - Math.max(0, call.preparationMinutes) * 60_000;
    if (canNotify && call.preparationMinutes > 0 && now >= preparationAt && !call.preparationSentAt) {
      const reminded = { ...call, preparationSentAt: new Date(now).toISOString() };
      actions.push({ kind: 'preparation', call: reminded, lateByMs: 0 });
      return reminded;
    }
    return call;
  });
  return { calls: nextCalls, actions };
}

export function readScheduledCalls(storage: Pick<Storage, 'getItem'> = localStorage): ScheduledCall[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SCHEDULED_CALLS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((call): call is ScheduledCall => !!call && typeof call === 'object'
      && typeof call.id === 'string' && typeof call.taskId === 'string'
      && typeof call.callAt === 'string' && typeof call.status === 'string');
  } catch {
    return [];
  }
}

export function writeScheduledCalls(calls: ScheduledCall[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(SCHEDULED_CALLS_KEY, JSON.stringify(calls));
}

export function toLocalDateTimeValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid date and time.');
  return date.toISOString();
}

export function getNextScheduledCall(calls: ScheduledCall[], now = Date.now()): ScheduledCall | undefined {
  return calls.filter(call => call.status === 'scheduled' && !call.test && Date.parse(call.callAt) > now)
    .sort((a, b) => Date.parse(a.callAt) - Date.parse(b.callAt))[0];
}

export function formatCountdown(target: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
