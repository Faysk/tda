export type TrustedAbsoluteTime = Readonly<{
	startIso: string;
	endIso: string;
	source: string;
}>;

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/u;
const CLOCK = /T(\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;

export function trustedAbsoluteIso(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length < 20 ||
		value.length > 64 ||
		!EXPLICIT_OFFSET.test(value) ||
		!Number.isFinite(Date.parse(value))
	)
		return null;
	return value;
}

export function parseTrustedAbsoluteTime(value: Readonly<{
	state: unknown;
	start: unknown;
	end: unknown;
	source: unknown;
}>): TrustedAbsoluteTime | null {
	if (value.state !== "trusted_absolute") return null;
	const startIso = trustedAbsoluteIso(value.start);
	const endIso = trustedAbsoluteIso(value.end);
	if (!startIso || !endIso || Date.parse(endIso) < Date.parse(startIso)) return null;
	if (typeof value.source !== "string" || value.source.length < 1 || value.source.length > 160)
		return null;
	return { startIso, endIso, source: value.source };
}

export function wallClockPresentation(iso: string): Readonly<{
	clock: string;
	offset: string;
	date: string;
	accessible: string;
}> | null {
	const trusted = trustedAbsoluteIso(iso);
	if (!trusted) return null;
	const match = CLOCK.exec(trusted);
	if (!match) return null;
	const date = trusted.slice(0, 10);
	return {
		clock: match[1],
		offset: match[2],
		date,
		accessible: `${date} ${match[1]} ${match[2] === "Z" ? "UTC" : "UTC" + match[2]}`,
	};
}

export function crossedAbsoluteDate(startIso: string, endIso: string): boolean {
	const start = wallClockPresentation(startIso);
	const end = wallClockPresentation(endIso);
	return Boolean(start && end && start.date !== end.date);
}
