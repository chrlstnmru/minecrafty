import { page } from '$app/state';
import { useSearchParams } from 'runed/kit';
import * as v from 'valibot';

const VIEWS = ['installed', 'browse'] as const;
export type View = (typeof VIEWS)[number];

/**
 * The Installed or Browse tab of a list page, kept in the URL (`?view=browse`) so a reload keeps it.
 * Read from the page URL, which the server has, so the right tab is in the HTML; runed only reads
 * the URL in the browser, so it is used to write it. Browse falls back to Installed when
 * `canBrowse` says no (Browse is for adding). Call it while a component starts.
 */
export function viewParam(canBrowse: () => boolean = () => true) {
	const params = useSearchParams(
		v.object({ view: v.optional(v.fallback(v.picklist(VIEWS), 'installed'), 'installed') }),
		{ pushHistory: false, noScroll: true }
	);
	const current = $derived<View>(
		(canBrowse() && VIEWS.find((name) => name === page.url.searchParams.get('view'))) || 'installed'
	);
	return {
		get current() {
			return current;
		},
		set current(next: View) {
			params.view = next;
		}
	};
}
