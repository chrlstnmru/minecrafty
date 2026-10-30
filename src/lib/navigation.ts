import { page } from '$app/state';

/**
 * The URL in the address bar. A shallow `goto` (`{ shallow: true }`) changes the address bar and
 * `page.shallow.url` but leaves `page.url` at the last full navigation, so read query params
 * that shallow navigation sets through this. Reactive like `page`.
 */
export function currentUrl() {
	return page.shallow?.url ?? page.url;
}
