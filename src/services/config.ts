import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, DefaultPrompts } from "@/types";
import { isTauriEnv } from "@/utils/env";

function ensureTauri(): void {
  if (!isTauriEnv()) {
    throw new Error(
      "此功能仅在 Tauri 桌面应用中可用。请在资源管理器中双击运行 aigit.exe，而不是在浏览器中访问。"
    );
  }
}

export const configService = {
  getConfig: () => {
    ensureTauri();
    return invoke<AppConfig>("get_config");
  },

  saveConfig: (config: AppConfig) => {
    ensureTauri();
    return invoke<void>("save_config", { config });
  },

  addRecentRepo: (path: string) => {
    ensureTauri();
    return invoke<AppConfig>("add_recent_repo", { path });
  },

  getDefaultPrompts: () => {
    ensureTauri();
    return invoke<DefaultPrompts>("get_default_prompts");
  },
};
