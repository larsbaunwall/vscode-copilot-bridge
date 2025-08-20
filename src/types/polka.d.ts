declare module 'polka' {
	import { IncomingMessage, ServerResponse } from 'http';

	export interface PolkaRequest extends IncomingMessage {
		params?: Record<string, string>;
	}

	export type Next = () => void;
	export type Middleware = (req: PolkaRequest, res: ServerResponse, next: Next) => void;
	export type Handler = (req: PolkaRequest, res: ServerResponse) => void;

	export interface PolkaOptions {
		onError?: (err: Error, req: PolkaRequest, res: ServerResponse, next: Next) => void;
		onNoMatch?: (req: PolkaRequest, res: ServerResponse) => void;
	}

	export interface PolkaInstance {
		use(mw: Middleware): PolkaInstance;
		use(path: string, mw: Middleware): PolkaInstance;
		get(path: string, handler: Handler): PolkaInstance;
		post(path: string, handler: Handler): PolkaInstance;
		put(path: string, handler: Handler): PolkaInstance;
		delete(path: string, handler: Handler): PolkaInstance;
		listen(port: number, host: string, cb: () => void): void;
		server?: import('http').Server;
	}

	function polka(options?: PolkaOptions): PolkaInstance;
	export default polka;
}
