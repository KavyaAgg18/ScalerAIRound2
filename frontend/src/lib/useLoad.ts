import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

// Deliberately tiny. If we end up refetching the same data in many places, switch to TanStack Query.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e : new ApiError(0, String(e))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// Filter/sort/page live in the query string so refresh and back/forward keep the view.
export function setQuery(
  params: URLSearchParams,
  updates: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  return `?${p.toString()}`;
}
