import type { Loader } from './loader-list.js';

/** The tint of each loader, the same one its icon in `assets/loaders/` is drawn in. */
export const loaderColors: Record<Loader, string> = {
	vanilla: '#79c14d',
	paper: '#6fa8ff',
	purpur: '#c084fc',
	fabric: '#dbb69b',
	quilt: '#c58be8',
	forge: '#959eef',
	neoforge: '#f99e5f'
};
