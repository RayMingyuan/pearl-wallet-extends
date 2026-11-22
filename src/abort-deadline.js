// Bound a fetch so a stuck indexer connection cannot freeze the popup for a minute.
export function bindDeadline(signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new DOMException("Timeout", "TimeoutError"));
  }, ms);
  const stop = () => clearTimeout(timer);
  if (signal) {
    if (signal.aborted) {
      stop();
      ctrl.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => {
        stop();
        ctrl.abort(signal.reason);
      }, { once: true });
    }
  }
  ctrl.signal.addEventListener("abort", stop, { once: true });
  return ctrl.signal;
}
