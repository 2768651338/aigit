import { invoke } from "@tauri-apps/api/core";
import { isTauriEnv } from "@/utils/env";

function ensureTauri(): void {
  if (!isTauriEnv()) {
    throw new Error(
      "此功能仅在 Tauri 桌面应用中可用。请在资源管理器中双击运行 aigit.exe，而不是在浏览器中访问。"
    );
  }
}

export const systemService = {
  /**
   * Open the OS terminal rooted at `path`. The backend validates that the
   * path is a real git repository before spawning anything.
   */
  openInTerminal: (path: string) => {
    ensureTauri();
    return invoke<void>("open_repo_in_terminal", { path });
  },
};
