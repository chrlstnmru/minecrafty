import { insertInstance } from '../lib/server/instances';

let port = 26000;

/** A database row and folder for an instance, without installing any server software. */
export function makeInstance(overrides: Partial<Parameters<typeof insertInstance>[0]> = {}) {
	return insertInstance({
		name: 'test instance',
		loader: 'vanilla',
		mcVersion: '1.21.4',
		port: port++,
		ramMinMb: 512,
		ramMaxMb: 1024,
		jvmArgs: '',
		autoStart: false,
		eulaAccepted: true,
		...overrides
	});
}
