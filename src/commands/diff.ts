import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { parseClaudeResponse, buildFileTree } from "../parser.js";
import { readInputFile, writeFile } from "../scaffold.js";
import {
  printBanner, printSuccess, printInfo,
  printFileTree, spinner, readMultilineInput, c,
} from "../ui.js";

export interface DiffOptions {
  file?: string;
  dir: string;
  yes: boolean;
}

interface FileDiff {
  filePath: string;
  status: "new" | "modified" | "unchanged";
  newContent: string;
  oldContent: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
}

export async function runDiff(opts: DiffOptions) {
  await printBanner();

  const dir = fs.realpathSync(path.resolve(opts.dir));

  let claudeResponse: string;
  if (opts.file) {
    claudeResponse = readInputFile(opts.file);
    printInfo(`Reading from ${c.path(opts.file)}`);
  } else {
    claudeResponse = await readMultilineInput(
      "Paste your Claude response containing ``` code blocks:"
    );
  }

  if (!claudeResponse.trim()) {
    throw new Error("No input received. Use --file or paste a Claude response.");
  }

  const spinParse = spinner("Parsing Claude response...");
  const parseResult = parseClaudeResponse(claudeResponse);
  spinParse.stop();

  if (parseResult.files.length === 0) {
    throw new Error(
      "No files found in the response.\n" +
      "Ensure code blocks include a file path as the first line."
    );
  }

  printSuccess(
    `Parsed ${c.bold(String(parseResult.files.length))} files from ${parseResult.rawBlocks} code blocks`
  );
  printFileTree(buildFileTree(parseResult.files));
  console.log();

  const diffs: FileDiff[] = [];
  let newCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;

  for (const file of parseResult.files) {
    const existingPath = path.join(dir, file.path);
    let oldContent = "";
    let exists = false;

    try {
      oldContent = fs.readFileSync(existingPath, "utf8");
      exists = true;
    } catch {
      // file doesn't exist on disk
    }

    if (!exists) {
      newCount++;
      diffs.push({
        filePath: file.path,
        status: "new",
        newContent: file.content,
        oldContent: "",
        hunks: [{
          oldStart: 0, oldCount: 0,
          newStart: 1, newCount: file.content.split("\n").length,
          lines: file.content.split("\n").map((l) => ({ type: "add", content: l })),
        }],
      });
    } else if (oldContent === file.content) {
      unchangedCount++;
      diffs.push({
        filePath: file.path,
        status: "unchanged",
        newContent: file.content,
        oldContent,
        hunks: [],
      });
    } else {
      modifiedCount++;
      const hunks = computeDiffHunks(oldContent.split("\n"), file.content.split("\n"));
      diffs.push({
        filePath: file.path,
        status: "modified",
        newContent: file.content,
        oldContent,
        hunks,
      });
    }
  }

  console.log();
  printInfo(
    `${c.success(String(newCount) + " new")}  ` +
    `${c.warn(String(modifiedCount) + " modified")}  ` +
    `${c.dim(String(unchangedCount) + " unchanged")}`
  );
  console.log();

  const actionable = diffs.filter((d) => d.status !== "unchanged");

  if (actionable.length === 0) {
    printSuccess("All files are identical. Nothing to apply.");
    return;
  }

  for (const diff of actionable) {
    const label = diff.status === "new"
      ? c.success("NEW")
      : c.warn("MODIFIED");
    console.log(`  ${label}  ${c.path(diff.filePath)}`);

    for (const hunk of diff.hunks) {
      const header = c.info(
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
      );
      console.log(`    ${header}`);
      for (const line of hunk.lines) {
        if (line.type === "add") {
          console.log(c.success(`    + ${line.content}`));
        } else if (line.type === "remove") {
          console.log(c.error(`    - ${line.content}`));
        } else {
          console.log(c.dim(`      ${line.content}`));
        }
      }
    }
    console.log();
  }

  let toApply: FileDiff[];

  if (opts.yes) {
    toApply = actionable;
    printInfo(`Applying all ${actionable.length} changes (--yes)`);
  } else {
    const { selected } = await inquirer.prompt<{ selected: string[] }>([{
      type: "checkbox",
      name: "selected",
      message: "Select files to apply:",
      choices: actionable.map((d) => ({
        name: `${d.status === "new" ? "[NEW]     " : "[MODIFIED]"} ${d.filePath}`,
        value: d.filePath,
        checked: true,
      })),
      pageSize: Math.min(actionable.length + 2, Math.max(10, (process.stdout.rows ?? 24) - 6)),
    }]);

    if (selected.length === 0) {
      printInfo("No files selected. Nothing applied.");
      return;
    }

    toApply = actionable.filter((d) => selected.includes(d.filePath));
  }

  const spinWrite = spinner(`Applying ${toApply.length} file(s)...`);
  for (const diff of toApply) {
    writeFile(dir, diff.filePath, diff.newContent);
  }
  spinWrite.succeed(`Applied ${toApply.length} file(s)`);

  const newApplied = toApply.filter((d) => d.status === "new").length;
  const modApplied = toApply.filter((d) => d.status === "modified").length;
  if (newApplied > 0) printSuccess(`  ${newApplied} new file(s) created`);
  if (modApplied > 0) printSuccess(`  ${modApplied} file(s) updated`);
}

// ─── Myers diff algorithm (simplified) ──────────────────────────────────────

function computeDiffHunks(oldLines: string[], newLines: string[], contextSize = 3): DiffHunk[] {
  const edits = myersDiff(oldLines, newLines);
  return buildHunks(edits, oldLines, newLines, contextSize);
}

type EditType = "equal" | "insert" | "delete";

interface Edit {
  type: EditType;
  oldIdx: number;
  newIdx: number;
}

function myersDiff(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const vSize = 2 * max + 1;
  const v = new Int32Array(vSize).fill(-1);
  const offset = max;
  v[offset + 1] = 0;

  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    const snapshot = new Int32Array(vSize);
    snapshot.set(v);
    trace.push(snapshot);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  const edits: Edit[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d]!;
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && snap[offset + k - 1] < snap[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = snap[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.unshift({ type: "equal", oldIdx: x, newIdx: y });
    }

    if (d > 0) {
      if (x === prevX) {
        edits.unshift({ type: "insert", oldIdx: x, newIdx: y - 1 });
        y--;
      } else {
        edits.unshift({ type: "delete", oldIdx: x - 1, newIdx: y });
        x--;
      }
    }
  }

  return edits;
}

function buildHunks(edits: Edit[], oldLines: string[], newLines: string[], ctx: number): DiffHunk[] {
  const changes: Array<{ type: "context" | "add" | "remove"; content: string; oldLine: number; newLine: number }> = [];

  for (const edit of edits) {
    if (edit.type === "equal") {
      changes.push({ type: "context", content: oldLines[edit.oldIdx]!, oldLine: edit.oldIdx + 1, newLine: edit.newIdx + 1 });
    } else if (edit.type === "delete") {
      changes.push({ type: "remove", content: oldLines[edit.oldIdx]!, oldLine: edit.oldIdx + 1, newLine: -1 });
    } else {
      changes.push({ type: "add", content: newLines[edit.newIdx]!, oldLine: -1, newLine: edit.newIdx + 1 });
    }
  }

  // Group changes into hunks separated by more than ctx*2 context lines
  const hunks: DiffHunk[] = [];
  let currentHunk: typeof changes = [];
  let lastChangeIdx = -999;

  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i]!;
    if (ch.type !== "context") {
      const gapStart = Math.max(0, i - ctx);
      if (currentHunk.length === 0 || gapStart <= lastChangeIdx + ctx + 1) {
        // extend current hunk with leading context
        const contextStart = currentHunk.length === 0 ? gapStart : lastChangeIdx + 1;
        for (let j = contextStart; j < i; j++) {
          if (!currentHunk.includes(changes[j]!)) currentHunk.push(changes[j]!);
        }
        currentHunk.push(ch);
      } else {
        // flush and start new hunk (add trailing context to old)
        const trailingEnd = Math.min(changes.length, lastChangeIdx + ctx + 1);
        for (let j = lastChangeIdx + 1; j < trailingEnd; j++) {
          currentHunk.push(changes[j]!);
        }
        hunks.push(hunkFromChanges(currentHunk));
        currentHunk = [];
        for (let j = gapStart; j <= i; j++) {
          currentHunk.push(changes[j]!);
        }
      }
      lastChangeIdx = i;
    }
  }

  if (currentHunk.length > 0) {
    const trailingEnd = Math.min(changes.length, lastChangeIdx + ctx + 1);
    for (let j = lastChangeIdx + 1; j < trailingEnd; j++) {
      if (!currentHunk.includes(changes[j]!)) currentHunk.push(changes[j]!);
    }
    hunks.push(hunkFromChanges(currentHunk));
  }

  return hunks;
}

function hunkFromChanges(
  changes: Array<{ type: "context" | "add" | "remove"; content: string; oldLine: number; newLine: number }>
): DiffHunk {
  let oldStart = Infinity;
  let newStart = Infinity;
  let oldCount = 0;
  let newCount = 0;

  for (const ch of changes) {
    if (ch.type === "context") {
      if (ch.oldLine < oldStart) oldStart = ch.oldLine;
      if (ch.newLine < newStart) newStart = ch.newLine;
      oldCount++;
      newCount++;
    } else if (ch.type === "remove") {
      if (ch.oldLine < oldStart) oldStart = ch.oldLine;
      oldCount++;
    } else {
      if (ch.newLine < newStart) newStart = ch.newLine;
      newCount++;
    }
  }

  if (oldStart === Infinity) oldStart = 1;
  if (newStart === Infinity) newStart = 1;

  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines: changes.map((ch) => ({ type: ch.type, content: ch.content })),
  };
}
