"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMessages = normalizeMessages;
function normalizeMessages(messages, maxTurns) {
    const sys = [...messages].reverse().find(m => m.role === 'system')?.content;
    const dialog = messages.filter(m => m.role !== 'system');
    const turns = [];
    let userCount = 0;
    for (let i = dialog.length - 1; i >= 0; i--) {
        const m = dialog[i];
        turns.unshift(m);
        if (m.role === 'user') {
            userCount++;
            if (userCount >= maxTurns)
                break;
        }
    }
    const lines = [];
    if (sys) {
        lines.push('[SYSTEM]');
        lines.push(sys);
    }
    lines.push('[DIALOG]');
    for (const m of turns) {
        lines.push(`${m.role}: ${m.content}`);
    }
    return lines.join('\n');
}
