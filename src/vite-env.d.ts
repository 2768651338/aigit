/// <reference types="vite/client" />

interface TauriInvoke {
  <T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

/** 构建期由 vite.config.ts 从 package.json 注入的应用版本号 */
declare const __APP_VERSION__: string;

declare global {
  interface Window {
    __TAURI_INTERNALS__: unknown;
  }
}
