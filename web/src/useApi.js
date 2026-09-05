// A custom hook that loads data from the backend and reports one of three states.
//
// A "hook" is a reusable piece of React logic. Any function whose name starts with "use"
// and which calls other hooks is one. This wraps the loading / error / ready pattern from
// milestone 1 so every screen gets it for free instead of writing it out again.
//
// Usage inside a screen:
//   const { state, data, error, reload } = useApi(api.today);
//   if (state === 'loading') return <Loading />;
//   if (state === 'error')   return <ErrorPanel message={error} onRetry={reload} />;

import { useState, useEffect, useCallback } from 'react';

export function useApi(fetcher, dependencies = []) {
  const [result, setResult] = useState({ state: 'loading' });

  // useCallback keeps the same function between renders unless its dependencies change.
  // Without it, the useEffect below would see a "new" function on every render and reload
  // in a loop forever.
  const load = useCallback(async () => {
    setResult({ state: 'loading' });
    try {
      const data = await fetcher();
      setResult({ state: 'ready', data });
    } catch (error) {
      setResult({ state: 'error', error: error.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    let cancelled = false;

    // The same guard as milestone 1: if the screen changes before the reply arrives,
    // do not try to update a component that is no longer on screen.
    (async () => {
      setResult({ state: 'loading' });
      try {
        const data = await fetcher();
        if (!cancelled) setResult({ state: 'ready', data });
      } catch (error) {
        if (!cancelled) setResult({ state: 'error', error: error.message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { ...result, reload: load };
}
