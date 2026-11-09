import { rpc } from '../../lib/bridge';

// Begin and cancel are serialized across the Watch and Settings screens. This
// also covers navigation while a begin request is still in flight.
let controlQueue: Promise<void> = Promise.resolve();
const pendingCancellations = new Set<string>();
let activeAttempt: { promise: Promise<string>; supersede: () => void } | null = null;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = controlQueue.then(operation);
  controlQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function retryCancellations(): Promise<void> {
  for (const sessionId of pendingCancellations) {
    await rpc('kino_cancel_auth', { sessionId });
    pendingCancellations.delete(sessionId);
  }
}

export function settleKinoCancellations(): Promise<void> {
  return enqueue(retryCancellations);
}

function supersedeActiveAttempt(): void {
  if (activeAttempt) {
    const previous = activeAttempt;
    previous.supersede();
    if (activeAttempt === previous) void cancelKinoAttempt(previous.promise).catch(() => undefined);
  }
}

export function beginKinoAttempt(supersede: () => void): Promise<string> {
  supersedeActiveAttempt();
  const promise = enqueue(async () => {
    await retryCancellations();
    const result = await rpc<{ sessionId: string }>('kino_begin_auth');
    if (!result || typeof result.sessionId !== 'string' || !result.sessionId) {
      throw new Error('Не удалось начать авторизацию Kino.');
    }
    return result.sessionId;
  });
  activeAttempt = { promise, supersede };
  return promise;
}

export function isCurrentKinoAttempt(attempt: Promise<string>): boolean {
  return activeAttempt?.promise === attempt;
}

export function cancelKinoAttempt(attempt: Promise<string>): Promise<void> {
  if (activeAttempt?.promise === attempt) activeAttempt = null;
  return enqueue(async () => {
    let sessionId: string;
    try {
      sessionId = await attempt;
    } catch {
      return;
    }
    pendingCancellations.add(sessionId);
    await retryCancellations();
  });
}

export function finishKinoAttempt(sessionId: string, attempt: Promise<string>): void {
  if (activeAttempt?.promise === attempt) activeAttempt = null;
  void rpc('kino_finish_auth', { sessionId }).catch(() => undefined);
}

export function logoutKinoSession(): Promise<void> {
  supersedeActiveAttempt();
  return enqueue(async () => {
    await rpc('kino_logout');
    pendingCancellations.clear();
  });
}
