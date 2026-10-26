import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useSyncExternalStore } from 'react';
import { viewState } from './viewState';

export function useViewState<T>(
  key: string,
  initial: T,
  valid?: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback(
    (listener: () => void) => viewState.subscribe(key, listener),
    [key],
  );
  const read = () => viewState.read(key, initial, valid);
  const value = useSyncExternalStore(subscribe, read, read);
  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      const current = viewState.read(key, initial, valid);
      viewState.write(key, typeof next === 'function' ? (next as (value: T) => T)(current) : next);
    },
    [key],
  );
  return [value, setValue];
}
