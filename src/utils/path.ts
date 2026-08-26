/** Extract a human-readable name from an absolute path's last segment. */
export function pathLeaf(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
