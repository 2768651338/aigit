import { invoke } from "@tauri-apps/api/core";
import type { CodeSearchHit, IndexStatus } from "@/types";
import { isTauriEnv } from "@/utils/env";

function ensureTauri() {
  if (!isTauriEnv()) throw new Error("Code index is only available in the desktop app.");
}

export const codeIndexService = {
  status(repoPath: string) { ensureTauri(); return invoke<IndexStatus>("get_code_index_status", { repoPath }); },
  rebuild(repoPath: string, force = false) { ensureTauri(); return invoke<IndexStatus>("rebuild_code_index", { repoPath, force }); },
  cancel(repoPath: string) { ensureTauri(); return invoke<boolean>("cancel_code_index", { repoPath }); },
  delete(repoPath: string) { ensureTauri(); return invoke<boolean>("delete_code_index", { repoPath }); },
  search(repoPath: string, query: string, topK?: number) { ensureTauri(); return invoke<CodeSearchHit[]>("search_code_index", { repoPath, query, topK }); },
};
