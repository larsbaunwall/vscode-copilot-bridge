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
exports.pickPort = pickPort;
exports.getOrPickPort = getOrPickPort;
const net = __importStar(require("net"));
async function pickPort(preferred) {
    if (preferred && preferred > 0)
        return preferred;
    const port = await new Promise((resolve) => {
        const srv = net.createServer();
        srv.on('listening', () => {
            const addr = srv.address();
            srv.close(() => resolve(typeof addr === 'string' ? 0 : addr?.port || 0));
        });
        srv.listen(0, '127.0.0.1');
    });
    return port;
}
async function getOrPickPort(ctx, key, preferred) {
    if (preferred && preferred > 0) {
        await ctx.globalState.update(key, preferred);
        return preferred;
    }
    const existing = ctx.globalState.get(key);
    if (existing && existing > 0)
        return existing;
    const p = await pickPort(undefined);
    await ctx.globalState.update(key, p);
    return p;
}
