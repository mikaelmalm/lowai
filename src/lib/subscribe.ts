export function openSubscription(listen: () => Promise<() => void>): () => void {
  let alive = true;
  let stop: (() => void) | null = null;
  void listen().then((fn) => {
    if (!alive) {
      fn();
      return;
    }
    stop = fn;
  });
  return () => {
    alive = false;
    stop?.();
    stop = null;
  };
}
