import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isIpAddress } from './players';

describe('isIpAddress', () => {
	const cases = [
		'1.2.3.4',
		'255.255.255.255',
		'0.0.0.0',
		'127.0.0.1',
		'256.1.1.1',
		'1.2.3',
		'1.2.3.4.5',
		'01.2.3.4',
		'1.2.3.-4',
		'a.b.c.d',
		'::1',
		'::',
		'2001:db8::1',
		'2001:0db8:0000:0000:0000:ff00:0042:8329',
		'::ffff:192.168.0.1',
		'1::2::3',
		'12345::1',
		'g::1',
		'[::1]',
		'',
		' ',
		'1.2.3.4 ',
		'1.2.3.4 extra',
		'not an ip',
		'localhost',
		'example.com',
		'10.0.0.1;op'
	];

	it('refuses a zone id, which Node accepts and a ban list has no use for', () => {
		expect(isIpAddress('fe80::1%eth0')).toBe(false);
	});

	it.each(cases)('agrees with Node on %j', (value) => {
		expect(isIpAddress(value)).toBe(isIP(value) !== 0);
	});
});
