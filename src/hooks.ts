import { useEffect, useState } from "react";

export type Async<T> = { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; data: T };

/** Runs a loader once per `deps` change. Loaders in data.ts are memoised, so
 *  remounting a page doesn't refetch. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    load().then(
      (data) => live && setState({ status: "ready", data }),
      (err) => live && setState({ status: "error", error: err instanceof Error ? err : new Error(String(err)) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Sets the browser tab title while the page is mounted. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Colonist Analytics` : "Colonist Analytics";
  }, [title]);
}
