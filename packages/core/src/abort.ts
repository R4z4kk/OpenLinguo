/**
 * Aborts when either signal does, until `release`. Replaces `AbortSignal.any`: in WebKit its signal
 * can be collected while a fetch waits on it, and the abort never reaches the fetch (Playwright
 * WebKit 1.64, 3 runs in 8). Here the source signals hold the controller through their listeners.
 */
export const eitherSignal = (
  first: AbortSignal,
  second: AbortSignal,
): { readonly signal: AbortSignal; readonly release: () => void } => {
  const controller = new AbortController();
  const forward = (): void => {
    controller.abort();
  };
  if (first.aborted || second.aborted) controller.abort();
  else {
    first.addEventListener("abort", forward, { once: true });
    second.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => {
      first.removeEventListener("abort", forward);
      second.removeEventListener("abort", forward);
    },
  };
};
