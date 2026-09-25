const TERMINAL_JOB_DELETE_MINIMUM = [0, 3, 11] as const;
export const AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION = "0.3.14";
const AUTOMATIC_LOOPBACK_SESSION_MINIMUM = [0, 3, 14] as const;
export const QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION = "1.0.11";
const QWEN_ALIGNMENT_RUNTIME_MINIMUM = [1, 0, 11] as const;

function parseVersion(value: string | null | undefined): readonly [number, number, number] | null {
	if (!value) return null;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(
	serviceVersion: string | null | undefined,
	minimum: readonly [number, number, number],
): boolean {
	const parsed = parseVersion(serviceVersion);
	if (!parsed) return false;
	for (let index = 0; index < minimum.length; index++) {
		if (parsed[index] > minimum[index]) return true;
		if (parsed[index] < minimum[index]) return false;
	}
	return true;
}

export function supportsTerminalJobDelete(
	serviceVersion: string | null | undefined,
): boolean {
	return atLeast(serviceVersion, TERMINAL_JOB_DELETE_MINIMUM);
}

export function supportsAutomaticLoopbackSession(
	serviceVersion: string | null | undefined,
): boolean {
	return atLeast(serviceVersion, AUTOMATIC_LOOPBACK_SESSION_MINIMUM);
}

export function supportsQwenAlignmentRuntime(
	runtimeVersion: string | null | undefined,
): boolean {
	return atLeast(runtimeVersion, QWEN_ALIGNMENT_RUNTIME_MINIMUM);
}
