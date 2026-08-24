/**
 * Helpers for building `.gitignore` rules from a changed file path.
 *
 * All patterns are anchored with a leading `/` so they only ever match at the
 * repository root — ignoring `src/components/` must never also ignore an
 * unrelated `vendor/src/components/` elsewhere in the tree.
 */

/** Normalize a repo-relative file path to forward slashes without leading/trailing separators. */
export function normalizeRepoPath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function dirOf(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? null : path.slice(0, idx);
}

export interface IgnoreTargets {
  /** Pattern that ignores exactly this file, e.g. `/src/a/b.ts`. */
  file: string;
  /** Pattern for the containing directory, e.g. `/src/a/`. Null for repo-root files. */
  dir: string | null;
  /** Pattern for the parent of the containing directory, e.g. `/src/`. */
  parentDir: string | null;
}

/**
 * Derive the three ignore variants offered in the file context menu:
 * the file itself, its directory, and its directory's parent.
 */
export function buildIgnoreTargets(filePath: string): IgnoreTargets {
  const normalized = normalizeRepoPath(filePath);
  const dir = dirOf(normalized);
  const parent = dir ? dirOf(dir) : null;
  return {
    file: `/${normalized}`,
    dir: dir ? `/${dir}/` : null,
    parentDir: parent ? `/${parent}/` : null,
  };
}
