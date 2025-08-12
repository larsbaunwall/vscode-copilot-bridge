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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const openai_1 = require("./http/openai");
const server_1 = require("./rpc/server");
const ports_1 = require("./utils/ports");
const log_1 = require("./utils/log");
let httpClose;
let rpcClose;
let chatAccess;
let statusItem;
async function ensureCopilotAccess() {
    try {
        chatAccess = await vscode.chat.requestChatAccess('copilot');
        return true;
    }
    catch {
        chatAccess = undefined;
        return false;
    }
}
function getAccess() {
    return chatAccess;
}
async function startServers(ctx) {
    const cfg = vscode.workspace.getConfiguration();
    const bindAddress = cfg.get('bridge.bindAddress', '127.0.0.1');
    const openaiPref = cfg.get('bridge.openai.port', 0);
    const rpcPref = cfg.get('bridge.rpc.port', 0);
    const token = cfg.get('bridge.token', '');
    const readOnly = cfg.get('bridge.readOnly', true);
    const httpPort = await (0, ports_1.getOrPickPort)(ctx, 'bridge.openai.port', openaiPref);
    const rpcPort = await (0, ports_1.getOrPickPort)(ctx, 'bridge.rpc.port', rpcPref);
    const ok = await ensureCopilotAccess();
    const http = (0, openai_1.createHttpFacade)(getAccess, bindAddress, httpPort, token || undefined);
    httpClose = http.close;
    const rpc = (0, server_1.createRpcServer)(bindAddress, rpcPort, token || undefined, readOnly);
    rpcClose = rpc.close;
    if (!statusItem)
        statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.text = `Bridge: ON · Chat: ${ok ? 'OK' : 'Unavailable'}`;
    statusItem.show();
    (0, log_1.logInfo)(`Started. HTTP ${bindAddress}:${httpPort}, RPC ${bindAddress}:${rpcPort}`);
}
async function stopServers() {
    const tasks = [];
    if (httpClose)
        tasks.push(httpClose());
    if (rpcClose)
        tasks.push(rpcClose());
    await Promise.all(tasks);
    httpClose = undefined;
    rpcClose = undefined;
    if (statusItem) {
        statusItem.text = 'Bridge: OFF';
        statusItem.show();
    }
}
async function activate(ctx) {
    (0, log_1.getLogger)();
    const enable = vscode.workspace.getConfiguration().get('bridge.enabled', false);
    if (enable)
        await startServers(ctx);
    ctx.subscriptions.push(vscode.commands.registerCommand('bridge.enable', async () => {
        await startServers(ctx);
        vscode.window.showInformationMessage('Copilot Bridge enabled');
    }), vscode.commands.registerCommand('bridge.disable', async () => {
        await stopServers();
        vscode.window.showInformationMessage('Copilot Bridge disabled');
    }), vscode.commands.registerCommand('bridge.status', async () => {
        const cfg = vscode.workspace.getConfiguration();
        const bindAddress = cfg.get('bridge.bindAddress', '127.0.0.1');
        const httpPort = ctx.globalState.get('bridge.openai.port');
        const rpcPort = ctx.globalState.get('bridge.rpc.port');
        const ok = !!chatAccess;
        const ro = cfg.get('bridge.readOnly', true);
        const msg = `Chat: ${ok ? 'OK' : 'Unavailable'} · HTTP: ${bindAddress}:${httpPort} · RPC: ${bindAddress}:${rpcPort} · readOnly: ${ro}`;
        vscode.window.showInformationMessage(msg);
    }), { dispose: async () => { await stopServers(); } });
}
async function deactivate() {
    await stopServers();
}
