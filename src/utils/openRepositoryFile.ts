import { openPath } from "@tauri-apps/plugin-opener";

function joinRepoPath(repoPath: string, relativePath: string): string {
  const separator = repoPath.includes("\\") ? "\\" : "/";
  return `${repoPath.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

export async function openRepositoryFile(repoPath: string, relativePath: string): Promise<void> {
  if (!relativePath || relativePath.startsWith("/") || relativePath.startsWith("\\") || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error("Invalid repository-relative path");
  }
  await openPath(joinRepoPath(repoPath, relativePath));
}
