// Five-field cron expressions (minute hour day-of-month month day-of-week), the way cron reads
// them, in the server's local time. Pure, so the page and the scheduler agree on what one means.

export type CronSpec = {
	minutes: Set<number>;
	hours: Set<number>;
	days: Set<number>;
	months: Set<number>;
	weekdays: Set<number>;
	/** a "*" in the field: with both day fields restricted, either one matching is enough */
	anyDay: boolean;
	anyWeekday: boolean;
};

export type CronResult = { ok: true; spec: CronSpec } | { ok: false; error: string };

const ALIASES: Record<string, string> = {
	'@yearly': '0 0 1 1 *',
	'@annually': '0 0 1 1 *',
	'@monthly': '0 0 1 * *',
	'@weekly': '0 0 * * 0',
	'@daily': '0 0 * * *',
	'@midnight': '0 0 * * *',
	'@hourly': '0 * * * *'
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type Field = { name: string; min: number; max: number; names?: string[]; offset?: number };
const FIELDS: Field[] = [
	{ name: 'minute', min: 0, max: 59 },
	{ name: 'hour', min: 0, max: 23 },
	{ name: 'day of month', min: 1, max: 31 },
	{ name: 'month', min: 1, max: 12, names: MONTHS, offset: 1 },
	{ name: 'day of week', min: 0, max: 7, names: WEEKDAYS, offset: 0 }
];

function value(text: string, field: Field): number {
	const named = field.names?.indexOf(text.toLowerCase()) ?? -1;
	if (named >= 0) return named + (field.offset ?? 0);
	if (!/^\d+$/.test(text)) throw new Error(`"${text}" is not a number in the ${field.name} field`);
	const n = Number(text);
	if (n < field.min || n > field.max)
		throw new Error(`${n} is outside ${field.min}-${field.max} in the ${field.name} field`);
	return n;
}

function parseField(text: string, field: Field): Set<number> {
	const out = new Set<number>();
	for (const part of text.split(',')) {
		if (!part) throw new Error(`The ${field.name} field has an empty entry`);
		const [range, stepText, extra] = part.split('/');
		if (extra !== undefined) throw new Error(`"${part}" has more than one step`);
		let step = 1;
		if (stepText !== undefined) {
			if (!/^\d+$/.test(stepText) || Number(stepText) < 1)
				throw new Error(`"${part}" needs a step of 1 or more`);
			step = Number(stepText);
		}
		let from: number;
		let to: number;
		if (range === '*') {
			from = field.min;
			to = field.name === 'day of week' ? 6 : field.max;
		} else if (range.includes('-')) {
			const [a, b] = range.split('-');
			from = value(a, field);
			to = value(b, field);
			if (from > to) throw new Error(`"${range}" counts backwards in the ${field.name} field`);
		} else {
			from = value(range, field);
			// "5/10" means from 5 to the end, every 10
			to = stepText !== undefined ? field.max : from;
		}
		for (let n = from; n <= to; n += step) out.add(field.name === 'day of week' ? n % 7 : n);
	}
	return out;
}

export function parseCron(expression: string): CronResult {
	const text = ALIASES[expression.trim().toLowerCase()] ?? expression.trim();
	const parts = text.split(/\s+/);
	if (parts.length !== 5)
		return {
			ok: false,
			error: `Use five fields: minute hour day-of-month month day-of-week (got ${parts.filter(Boolean).length})`
		};
	try {
		const [minutes, hours, days, months, weekdays] = parts.map((part, i) =>
			parseField(part, FIELDS[i])
		);
		return {
			ok: true,
			spec: {
				minutes,
				hours,
				days,
				months,
				weekdays,
				anyDay: parts[2].startsWith('*'),
				anyWeekday: parts[4].startsWith('*')
			}
		};
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

function dayMatches(spec: CronSpec, date: Date) {
	const day = spec.days.has(date.getDate());
	const weekday = spec.weekdays.has(date.getDay());
	if (spec.anyDay && spec.anyWeekday) return true;
	if (spec.anyDay) return weekday;
	if (spec.anyWeekday) return day;
	return day || weekday;
}

/** Whether the minute `date` falls in is one the expression names. */
export function matches(spec: CronSpec, date: Date) {
	return (
		spec.minutes.has(date.getMinutes()) &&
		spec.hours.has(date.getHours()) &&
		spec.months.has(date.getMonth() + 1) &&
		dayMatches(spec, date)
	);
}

const MINUTE = 60_000;
const FIVE_YEARS = 5 * 366 * 24 * 60 * MINUTE;

/** The first matching minute strictly after `after`, or null when there is none within five years. */
export function nextRun(spec: CronSpec, after: Date): Date | null {
	const limit = after.getTime() + FIVE_YEARS;
	let t = new Date(after);
	t.setSeconds(0, 0);
	t = new Date(t.getTime() + MINUTE);
	while (t.getTime() < limit) {
		const y = t.getFullYear();
		const mo = t.getMonth();
		const d = t.getDate();
		const h = t.getHours();
		const min = t.getMinutes();
		let next: Date | null = null;
		if (!spec.months.has(mo + 1)) next = new Date(y, mo + 1, 1, 0, 0);
		else if (!dayMatches(spec, t)) next = new Date(y, mo, d + 1, 0, 0);
		else if (!spec.hours.has(h)) next = new Date(y, mo, d, h + 1, 0);
		else if (!spec.minutes.has(min)) next = new Date(y, mo, d, h, min + 1);
		else return t;
		// a clock change can make "the next hour" land on the same instant; always move on
		t = next.getTime() > t.getTime() ? next : new Date(t.getTime() + MINUTE);
	}
	return null;
}
