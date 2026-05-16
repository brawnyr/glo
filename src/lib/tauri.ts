// Wrapper around Tauri invoke/event that's safe to call from plain browser dev.

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;

let invokeImpl: InvokeFn | null = null;
let listenImpl: ListenFn | null = null;
let readyPromise: Promise<{ invoke: InvokeFn | null; listen: ListenFn | null }> | null = null;

function ensure(): Promise<{ invoke: InvokeFn | null; listen: ListenFn | null }> {
  // Concurrent callers must await the same in-flight load — previously a flag
  // flipped before the awaits, so the second caller bailed before imports resolved.
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        const isTauriEnv = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
        if (isTauriEnv) {
          const core = await import("@tauri-apps/api/core");
          const event = await import("@tauri-apps/api/event");
          invokeImpl = core.invoke as InvokeFn;
          listenImpl = event.listen as unknown as ListenFn;
        }
      } catch {
        invokeImpl = null;
        listenImpl = null;
      }
      return { invoke: invokeImpl, listen: listenImpl };
    })();
  }
  return readyPromise;
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: fn } = await ensure();
  if (!fn) throw new Error(`Tauri not available — cannot call ${cmd}`);
  return fn<T>(cmd, args);
}

export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<() => void> {
  const { listen: fn } = await ensure();
  if (!fn) return () => {};
  return fn<T>(event, handler);
}

export async function isTauri(): Promise<boolean> {
  return (await ensure()).invoke !== null;
}
