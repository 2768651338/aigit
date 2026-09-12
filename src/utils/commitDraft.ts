const KEY_PREFIX = "aigit.commitDraft.";
/** 草稿上限，超长不持久化（防 localStorage 失控），编辑区内容不受影响。 */
const MAX_DRAFT_CHARS = 20_000;

/**
 * 提交信息草稿：按仓库路径持久化到 localStorage（best-effort）。
 * 切换仓库或重启后提交框内容不丢失；空字符串表示清除草稿。
 */
export function loadCommitDraft(repoPath: string): string {
  try {
    return localStorage.getItem(KEY_PREFIX + repoPath) ?? "";
  } catch {
    return "";
  }
}

export function saveCommitDraft(repoPath: string, message: string): void {
  try {
    const key = KEY_PREFIX + repoPath;
    if (!message) {
      localStorage.removeItem(key);
    } else if (message.length <= MAX_DRAFT_CHARS) {
      localStorage.setItem(key, message);
    }
  } catch {
    // localStorage 不可用或已满：草稿持久化是尽力而为的增强，静默降级。
  }
}
