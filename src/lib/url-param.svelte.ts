import { goto } from '$app/navigation';
import { page } from '$app/state';

/**
 * One text value kept in the page's query string (`?filter=create`), so a reload or a shared link
 * shows the same thing. It writes with a shallow `goto`: no `load` runs and the focused input keeps
 * focus while typing. An empty value or `fallback` leaves the key out of the URL.
 */
export class UrlParam {
	#name: string;
	#fallback: string;
	#value = $state('');

	constructor(name: string, fallback = '') {
		this.#name = name;
		this.#fallback = fallback;
		// a shallow navigation leaves page.url where it was; the URL it went to is page.shallow
		this.#value = (page.shallow?.url ?? page.url).searchParams.get(name) ?? fallback;
	}

	get value() {
		return this.#value;
	}

	set value(next: string) {
		this.#value = next;
		const url = new URL(location.href);
		if (next && next !== this.#fallback) url.searchParams.set(this.#name, next);
		else url.searchParams.delete(this.#name);
		if (url.href !== location.href) void goto(url, { shallow: true, replace: true });
	}
}
