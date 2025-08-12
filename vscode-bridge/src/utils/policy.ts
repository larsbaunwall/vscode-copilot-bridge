import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { minimatch } from 'minimatch';

type Policy = {
  writes?: { allow?: string[]; deny?: string[] };
  shell?: { allow?: string[]; deny?: string[] };
};

function loadPolicy(): Policy | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const root = folders[0].uri.fsPath;
  const file = path.join(root, '.agent-policy.yaml');
  if (!fs.existsSync(file)) return undefined;
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return YAML.parse(txt) as Policy;
  } catch {
    return undefined;
  }
}

function matchGlobs(p: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return false;
  return globs.some(g => minimatch(p, g, { dot: true, nocase: true, matchBase: true }));
}

export function isWriteAllowed(targetPath: string, readOnly: boolean): { allowed: boolean; reason?: string } {
  if (readOnly) return { allowed: false, reason: 'readOnly' };
  const policy = loadPolicy();
  const rel = relativeToWorkspace(targetPath);
  if (!rel) return { allowed: false, reason: 'outsideWorkspace' };
  if (matchGlobs(rel, ['**/node_modules/**', '**/dist/**'])) return { allowed: false, reason: 'deniedDefault' };
  if (policy?.writes?.deny && matchGlobs(rel, policy.writes.deny)) return { allowed: false, reason: 'deniedPolicy' };
  if (policy?.writes?.allow && !matchGlobs(rel, policy.writes.allow)) return { allowed: false, reason: 'notAllowedByPolicy' };
  return { allowed: true };
}

function relativeToWorkspace(abs: string): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  const root = folders[0].uri.fsPath;
  if (!abs.startsWith(root)) return undefined;
  let rel = abs.slice(root.length);
  if (rel.startsWith(path.sep)) rel = rel.slice(1);
  return rel;
}
