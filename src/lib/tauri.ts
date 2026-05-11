// Thin wrapper around Tauri invoke that survives running in plain browser dev.

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: InvokeFn | null = null;
let initialized = false;

async function ensure(): Promise<InvokeFn | null> {
  if (initialized) return invokeImpl;
  initialized = true;
  try {
    const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!isTauri) return null;
    const mod = await import("@tauri-apps/api/core");
    invokeImpl = mod.invoke as InvokeFn;
  } catch {
    invokeImpl = null;
  }
  return invokeImpl;
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = await ensure();
  if (!fn) {
    throw new Error(`Tauri not available — cannot call ${cmd}`);
  }
  return fn<T>(cmd, args);
}

export async function isTauri(): Promise<boolean> {
  return (await ensure()) !== null;
}
