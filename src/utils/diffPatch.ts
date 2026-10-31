import type { DiffHunk, DiffLine, FileDiff } from "@/types";

interface IndexedLine { line: DiffLine; index: number; noNewline: boolean; }
interface PatchHunk { sourceStart: number; sourceCount: number; targetCount: number; lines: string[]; }

function hunkStart(hunk: DiffHunk, reverse: boolean): number {
  const declared = reverse ? hunk.new_start : hunk.old_start;
  if (declared !== undefined) return declared;
  const source = hunk.lines.find((line) => (reverse ? line.new_line_no : line.old_line_no) != null);
  if (source) return (reverse ? source.new_line_no : source.old_line_no) ?? 0;
  const other = hunk.lines.find((line) => (reverse ? line.old_line_no : line.new_line_no) != null);
  return Math.max(0, ((reverse ? other?.old_line_no : other?.new_line_no) ?? 1) - 1);
}

function selectedHunk(diff: FileDiff, hunkIndex: number, selected: Set<string> | undefined, reverse: boolean): PatchHunk {
  const hunk = diff.hunks[hunkIndex];
  if (!hunk) throw new Error("Selected diff is no longer available");
  const result: PatchHunk = { sourceStart: hunkStart(hunk, reverse), sourceCount: 0, targetCount: 0, lines: [] };
  const sourceType = reverse ? "add" : "delete";
  const targetType = reverse ? "delete" : "add";
  let sources: IndexedLine[] = [];
  let targets: IndexedLine[] = [];
  let previous: IndexedLine | undefined;
  const emit = (prefix: " " | "+" | "-", item: IndexedLine) => {
    result.lines.push(`${prefix}${item.line.content}`);
    if (item.noNewline) result.lines.push("\\ No newline at end of file");
    if (prefix !== "+") result.sourceCount += 1;
    if (prefix !== "-") result.targetCount += 1;
  };
  const includes = (item: IndexedLine) => !selected || selected.has(`${diff.path}::${hunkIndex}:${item.index}`);
  const flush = () => {
    // Pair adjacent replacement lines before retaining unselected neighbors.
    // Turning every unselected deletion into leading context moves a selected
    // replacement past its neighbors when Git groups all deletions first.
    for (let i = 0; i < Math.max(sources.length, targets.length); i++) {
      const source = sources[i];
      const target = targets[i];
      if (source) emit(includes(source) ? "-" : " ", source);
      if (target && includes(target)) emit("+", target);
    }
    sources = [];
    targets = [];
  };
  hunk.lines.forEach((line, index) => {
    if (line.line_type === "no_newline") {
      if (previous) previous.noNewline = true;
      return;
    }
    const item = { line, index, noNewline: hunk.lines[index + 1]?.line_type === "no_newline" };
    previous = item;
    if (line.line_type === sourceType) sources.push(item);
    else if (line.line_type === targetType) targets.push(item);
    else { flush(); emit(" ", item); }
  });
  flush();
  return result;
}

function filePatch(diff: FileDiff, hunks: PatchHunk[], reverse: boolean): string {
  const sourcePath = reverse ? diff.path : diff.old_path ?? diff.path;
  const targetPath = reverse ? diff.old_path ?? diff.path : diff.path;
  const quote = (path: string) => /[\s"\\]/.test(path) ? JSON.stringify(path) : path;
  const sourceMissing = reverse ? diff.is_deleted : diff.is_new;
  const targetMissing = (reverse ? diff.is_new : diff.is_deleted) && hunks.length === diff.hunks.length && hunks.every((hunk) => hunk.targetCount === 0);
  const lines = [`diff --git ${quote(`a/${sourcePath}`)} ${quote(`b/${targetPath}`)}`];
  if (sourceMissing) lines.push("new file mode 100644");
  if (targetMissing) lines.push("deleted file mode 100644");
  lines.push(`--- ${sourceMissing ? "/dev/null" : quote(`a/${sourcePath}`)}`, `+++ ${targetMissing ? "/dev/null" : quote(`b/${targetPath}`)}`);
  let offset = 0;
  for (const hunk of hunks) {
    const targetStart = hunk.sourceStart + offset + (hunk.sourceCount === 0 ? 1 : hunk.targetCount === 0 ? -1 : 0);
    lines.push(`@@ -${hunk.sourceStart},${hunk.sourceCount} +${targetStart},${hunk.targetCount} @@`, ...hunk.lines);
    offset += hunk.targetCount - hunk.sourceCount;
  }
  return `${lines.join("\n")}\n`;
}

export function buildHunkPatch(diff: FileDiff, hunkIndex: number, selected?: Set<string>, reverse = false): string {
  return filePatch(diff, [selectedHunk(diff, hunkIndex, selected, reverse)], reverse);
}

export function buildSelectionPatch(diffs: FileDiff[], selected: Set<string>, reverse = false): string {
  let found = 0;
  const patches: string[] = [];
  for (const diff of diffs) {
    const hunks: PatchHunk[] = [];
    diff.hunks.forEach((hunk, hunkIndex) => {
      const keys = new Set(hunk.lines.flatMap((line, index) => {
        const key = `${diff.path}::${hunkIndex}:${index}`;
        return (line.line_type === "add" || line.line_type === "delete") && selected.has(key) ? [key] : [];
      }));
      if (keys.size) { found += keys.size; hunks.push(selectedHunk(diff, hunkIndex, keys, reverse)); }
    });
    if (hunks.length) patches.push(filePatch(diff, hunks, reverse));
  }
  if (!found || found !== selected.size) throw new Error("Selected diff is no longer available");
  // A single git apply is atomic across selected files/hunks and independent
  // of the order in which the user clicked their checkboxes.
  return patches.join("");
}
