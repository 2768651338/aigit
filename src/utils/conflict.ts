export interface ConflictBlock {
  start: number;
  end: number;
  ours: string;
  base: string;
  theirs: string;
}

const START = /^<<<<<<<(?: .*)?$/;
const BASE = /^\|\|\|\|\|\|\|(?: .*)?$/;
const DIVIDER = /^=======$/;
const END = /^>>>>>>>(?: .*)?$/;

export function parseConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split("\n");
  const blocks: ConflictBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!START.test(lines[i])) continue;
    const start = i;
    let baseAt = -1;
    let dividerAt = -1;
    let endAt = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (baseAt < 0 && dividerAt < 0 && BASE.test(lines[j])) baseAt = j;
      else if (DIVIDER.test(lines[j])) dividerAt = j;
      else if (dividerAt >= 0 && END.test(lines[j])) {
        endAt = j;
        break;
      }
    }
    if (dividerAt < 0 || endAt < 0) continue;
    blocks.push({
      start,
      end: endAt,
      ours: lines.slice(start + 1, baseAt >= 0 ? baseAt : dividerAt).join("\n"),
      base: baseAt >= 0 ? lines.slice(baseAt + 1, dividerAt).join("\n") : "",
      theirs: lines.slice(dividerAt + 1, endAt).join("\n"),
    });
    i = endAt;
  }
  return blocks;
}

export function resolveConflictBlock(
  content: string,
  blockIndex: number,
  choice: "ours" | "theirs" | "both",
): string {
  const lines = content.split("\n");
  const block = parseConflictBlocks(content)[blockIndex];
  if (!block) return content;
  const selected = choice === "ours"
    ? block.ours
    : choice === "theirs"
      ? block.theirs
      : [block.ours, block.theirs].filter(Boolean).join("\n");
  lines.splice(block.start, block.end - block.start + 1, ...selected.split("\n"));
  return lines.join("\n");
}
