"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyUnifiedDiff = applyUnifiedDiff;
const vscode = __importStar(require("vscode"));
function parseUnifiedDiff(diff) {
    const lines = diff.replace(/\r\n/g, '\n').split('\n');
    const patches = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('--- ')) {
            const oldPath = lines[i].slice(4).trim().replace(/^a\//, '');
            i++;
            if (!lines[i] || !lines[i].startsWith('+++ '))
                break;
            const newPath = lines[i].slice(4).trim().replace(/^b\//, '');
            i++;
            const hunks = [];
            while (i < lines.length && lines[i].startsWith('@@')) {
                const m = /@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/.exec(lines[i]);
                if (!m)
                    break;
                const oldStart = parseInt(m[1], 10);
                const oldLines = m[2] ? parseInt(m[2], 10) : 0;
                const newStart = parseInt(m[3], 10);
                const newLines = m[4] ? parseInt(m[4], 10) : 0;
                i++;
                const hLines = [];
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
async function applyPatchToDocument(doc, patch) {
    const edit = new vscode.WorkspaceEdit();
    const conflicts = [];
    for (const h of patch.hunks) {
        const expectedOld = [];
        const newTextLines = [];
        for (const l of h.lines) {
            if (l.startsWith(' ')) {
                expectedOld.push(l.slice(1));
                newTextLines.push(l.slice(1));
            }
            else if (l.startsWith('-')) {
                expectedOld.push(l.slice(1));
            }
            else if (l.startsWith('+')) {
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
    if (conflicts.length > 0)
        return { ok: false, conflicts };
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied)
        return { ok: false, conflicts: ['applyFailed'] };
    await doc.save();
    return { ok: true, conflicts: [] };
}
async function applyUnifiedDiff(unifiedDiff) {
    const patches = parseUnifiedDiff(unifiedDiff);
    const conflicts = [];
    for (const p of patches) {
        const target = p.newPath || p.oldPath;
        if (!target)
            continue;
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
            if (!res.ok)
                conflicts.push(...res.conflicts);
        }
        catch (e) {
            conflicts.push(`fileNotFound:${target}`);
        }
    }
    if (conflicts.length > 0)
        return { ok: false, conflicts };
    return { ok: true, conflicts: [] };
}
