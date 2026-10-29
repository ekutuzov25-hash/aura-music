import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs an async loader, tracks loading/error, ignores stale results. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => id === seq.current && setState({ data, loading: false }),
      (e: Error) => id === seq.current && setState({ error: e?.message || 'Ошибка загрузки', loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}
