import { systemService } from "@/services/system";

export async function openRepositoryFile(repoPath: string, relativePath: string): Promise<void> {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new Error("Invalid repository-relative path");
  }
  // The backend re-validates the path against the repository root before
  // opening, so no unrestricted open-path capability is needed in the webview.
  await systemService.openRepoFile(repoPath, relativePath);
}
