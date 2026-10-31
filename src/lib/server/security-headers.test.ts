import { describe, expect, it } from 'vitest';
import { addSecurityHeaders } from './security-headers';

describe('security headers', () => {
	it('forbids framing, sniffing and outside referrers', () => {
		const headers = new Headers();
		addSecurityHeaders(headers);
		expect(headers.get('X-Frame-Options')).toBe('DENY');
		expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
		expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(headers.get('Referrer-Policy')).toBe('same-origin');
	});

	it('keeps a header the response set itself', () => {
		const headers = new Headers({ 'Referrer-Policy': 'no-referrer' });
		addSecurityHeaders(headers);
		expect(headers.get('Referrer-Policy')).toBe('no-referrer');
	});
});
