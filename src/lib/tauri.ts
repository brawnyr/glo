// Thin wrapper around Tauri invoke/event that survives running in plain browser dev.

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;

let invokeImpl: InvokeFn | null = null;
let listenImpl: ListenFn | null = null;
let initialized = false;

async function ensure(): Promise<{ invoke: InvokeFn | null; listen: ListenFn | null }> {
  if (!initialized) {
    initialized = true;
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
  }
  return { invoke: invokeImpl, listen: listenImpl };
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
