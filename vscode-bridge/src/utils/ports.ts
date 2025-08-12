import * as net from 'net';
import * as vscode from 'vscode';

export async function pickPort(preferred: number | undefined): Promise<number> {
  if (preferred && preferred > 0) return preferred;
  const port = await new Promise<number>((resolve) => {
    const srv = net.createServer();
    srv.on('listening', () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === 'string' ? 0 : addr?.port || 0));
    });
    srv.listen(0, '127.0.0.1');
  });
  return port;
}

export async function getOrPickPort(ctx: vscode.ExtensionContext, key: string, preferred: number | undefined): Promise<number> {
  if (preferred && preferred > 0) {
    await ctx.globalState.update(key, preferred);
    return preferred;
  }
  const existing = ctx.globalState.get<number>(key);
  if (existing && existing > 0) return existing;
  const p = await pickPort(undefined);
  await ctx.globalState.update(key, p);
  return p;
}
