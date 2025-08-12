import * as vscode from 'vscode';

type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

type FilePatch = {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
};

function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const patches: FilePatch[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('--- ')) {
      const oldPath = lines[i].slice(4).trim().replace(/^a\//, '');
      i++;
      if (!lines[i] || !lines[i].startsWith('+++ ')) break;
      const newPath = lines[i].slice(4).trim().replace(/^b\//, '');
      i++;
      const hunks: Hunk[] = [];
      while (i < lines.length && lines[i].startsWith('@@')) {
        const m = /@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/.exec(lines[i]);
        if (!m) break;
        const oldStart = parseInt(m[1], 10);
        const oldLines = m[2] ? parseInt(m[2], 10) : 0;
        const newStart = parseInt(m[3], 10);
        const newLines = m[4] ? parseInt(m[4], 10) : 0;
        i++;
        const hLines: string[] = [];
        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('--- ')) {
          hLines.push(lines[i]);
          i++;
        }
        hunks.push({ oldStart, oldLines, newStart, newLines, lines: hLines });
      }
      patches.push({ oldPath, newPath, hunks });
      continue;
    }
    i++;
  }
  return patches;
}

async function applyPatchToDocument(doc: vscode.TextDocument, patch: FilePatch): Promise<{ ok: boolean; conflicts: string[] }> {
  const edit = new vscode.WorkspaceEdit();
  const conflicts: string[] = [];
  for (const h of patch.hunks) {
    const expectedOld: string[] = [];
    const newTextLines: string[] = [];
    for (const l of h.lines) {
      if (l.startsWith(' ')) {
        expectedOld.push(l.slice(1));
        newTextLines.push(l.slice(1));
      } else if (l.startsWith('-')) {
        expectedOld.push(l.slice(1));
      } else if (l.startsWith('+')) {
        newTextLines.push(l.slice(1));
      }
    }
    const start = new vscode.Position(Math.max(0, h.oldStart - 1), 0);
    const endLine = Math.min(doc.lineCount, h.oldStart - 1 + expectedOld.length);
    const end = new vscode.Position(Math.max(0, endLine - 1), doc.lineAt(Math.max(0, endLine - 1)).range.end.character);
    const currentSlice = doc.getText(new vscode.Range(start, end));
    const currentLines = currentSlice.split('\n');
    if (expectedOld.length > 0 && expectedOld.join('\n') !== currentLines.join('\n')) {
      conflicts.push(`${patch.newPath}@${h.oldStart}`);
      continue;
    }
    edit.replace(doc.uri, new vscode.Range(start, end), newTextLines.join('\n'));
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) return { ok: false, conflicts: ['applyFailed'] };
  await doc.save();
  return { ok: true, conflicts: [] };
}

export async function applyUnifiedDiff(unifiedDiff: string): Promise<{ ok: boolean; conflicts: string[] }> {
  const patches = parseUnifiedDiff(unifiedDiff);
  const conflicts: string[] = [];
  for (const p of patches) {
    const target = p.newPath || p.oldPath;
    if (!target) continue;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      conflicts.push('noWorkspace');
      continue;
    }
    const workspaceRoot = folders[0].uri.fsPath;
    const fullPath = target.startsWith('/') ? target : `${workspaceRoot}/${target}`;
    const uri = vscode.Uri.file(fullPath);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const res = await applyPatchToDocument(doc, p);
      if (!res.ok) conflicts.push(...res.conflicts);
    } catch (e) {
      conflicts.push(`fileNotFound:${target}`);
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, conflicts: [] };
}
