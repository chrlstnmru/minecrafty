// Sent with every response. The policy covers what cannot break the app: no framing (so a page
// elsewhere cannot overlay the panel's buttons), no plugins, and forms and <base> kept to this
// origin. Scripts are not restricted: mode-watcher's inline theme script would need a nonce.
export const SECURITY_HEADERS: Record<string, string> = {
	'Content-Security-Policy':
		"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
	'X-Frame-Options': 'DENY',
	// a downloaded server file is never sniffed into HTML that would run as the panel
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin'
};

/** Adds the headers a response does not set itself. */
export function addSecurityHeaders(headers: Headers) {
	for (const [name, value] of Object.entries(SECURITY_HEADERS))
		if (!headers.has(name)) headers.set(name, value);
}
