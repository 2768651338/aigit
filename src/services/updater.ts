import { invoke } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdaterAvailability {
  enabled: boolean;
}

export interface AvailableUpdate {
  version: string;
  date?: string;
  body?: string;
}

let pendingUpdate: Update | null = null;

export const updaterService = {
  availability: () => invoke<UpdaterAvailability>("updater_availability"),

  async check(): Promise<AvailableUpdate | null> {
    pendingUpdate?.close().catch(() => undefined);
    pendingUpdate = await check();
    if (!pendingUpdate) return null;
    return {
      version: pendingUpdate.version,
      date: pendingUpdate.date,
      body: pendingUpdate.body,
    };
  },

  async downloadAndInstall(onProgress: (downloaded: number, total?: number) => void): Promise<void> {
    if (!pendingUpdate) throw new Error("No checked update is available");
    let downloaded = 0;
    await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") onProgress(0, event.data.contentLength);
      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress(downloaded);
      }
    });
    pendingUpdate = null;
    await relaunch();
  },
};
