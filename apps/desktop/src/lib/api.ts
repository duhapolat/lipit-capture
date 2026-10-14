import { invoke } from "@tauri-apps/api/core";

export const RUNNING_IN_TAURI = "__TAURI_INTERNALS__" in window;

/** Slightly above the backend's 45 s resolve limit, as a last-resort guard. */
export const RESOLVE_UI_TIMEOUT_MS = 50_000;

export const invokeWithTimeout = async <T,>(
  command: string,
  args: Record<string, unknown>,
  milliseconds = RESOLVE_UI_TIMEOUT_MS,
): Promise<T> => {
  let timer = 0;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => {
          void invoke("cancel_resolution").catch(() => {});
          reject({
            code: "RESOLVE_TIMEOUT",
            message: "Video zamanında çözümlenemedi. Bağlantıyı kontrol edip tekrar deneyin.",
          });
        }, milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
};
