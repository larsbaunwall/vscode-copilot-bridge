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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWriteAllowed = isWriteAllowed;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml_1 = __importDefault(require("yaml"));
const minimatch_1 = require("minimatch");
function loadPolicy() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return undefined;
    const root = folders[0].uri.fsPath;
    const file = path.join(root, '.agent-policy.yaml');
    if (!fs.existsSync(file))
        return undefined;
    try {
        const txt = fs.readFileSync(file, 'utf8');
        return yaml_1.default.parse(txt);
    }
    catch {
        return undefined;
    }
}
function matchGlobs(p, globs) {
    if (!globs || globs.length === 0)
        return false;
    return globs.some(g => (0, minimatch_1.minimatch)(p, g, { dot: true, nocase: true, matchBase: true }));
}
function isWriteAllowed(targetPath, readOnly) {
    if (readOnly)
        return { allowed: false, reason: 'readOnly' };
    const policy = loadPolicy();
    const rel = relativeToWorkspace(targetPath);
    if (!rel)
        return { allowed: false, reason: 'outsideWorkspace' };
    if (matchGlobs(rel, ['**/node_modules/**', '**/dist/**']))
        return { allowed: false, reason: 'deniedDefault' };
    if (policy?.writes?.deny && matchGlobs(rel, policy.writes.deny))
        return { allowed: false, reason: 'deniedPolicy' };
    if (policy?.writes?.allow && !matchGlobs(rel, policy.writes.allow))
        return { allowed: false, reason: 'notAllowedByPolicy' };
    return { allowed: true };
}
function relativeToWorkspace(abs) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0)
        return undefined;
    const root = folders[0].uri.fsPath;
    if (!abs.startsWith(root))
        return undefined;
    let rel = abs.slice(root.length);
    if (rel.startsWith(path.sep))
        rel = rel.slice(1);
    return rel;
}
