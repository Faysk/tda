const SCHEMA = "tda_qwen_runtime_bundle_v1";
const RUNTIME_ID = "qwen3-transformers";
const PLATFORM = "windows-x64";
const MAX_PARTS = 16;
const MAX_PART_BYTES = 2 * 1024 ** 3 - 1;
const MAX_ARCHIVE_BYTES = 16 * 1024 ** 3;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export type QwenRuntimePart = {
	index: number;
	name: string;
	size: number;
	sha256: string;
};

export type QwenRuntimeBundle = {
	schema: typeof SCHEMA;
	runtime_id: typeof RUNTIME_ID;
	platform: typeof PLATFORM;
	version: string;
	archive: { name: string; size: number; sha256: string };
	parts: QwenRuntimePart[];
};

function positiveInt(value: unknown, max: number): number | null {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= max
		? value
		: null;
}

export function parseQwenRuntimeBundle(
	value: unknown,
	expectedVersion?: string,
): QwenRuntimeBundle | null {
	if (!value || typeof value !== "object") return null;
	const input = value as Record<string, unknown>;
	if (
		input.schema !== SCHEMA ||
		input.runtime_id !== RUNTIME_ID ||
		input.platform !== PLATFORM ||
		typeof input.version !== "string" ||
		!VERSION.test(input.version) ||
		(expectedVersion !== undefined && input.version !== expectedVersion)
	) {
		return null;
	}
	const version = input.version;
	if (!input.archive || typeof input.archive !== "object") return null;
	const archive = input.archive as Record<string, unknown>;
	const archiveName = `TDAQwenRuntime-${version}-windows-x64.zip`;
	const archiveSize = positiveInt(archive.size, MAX_ARCHIVE_BYTES);
	if (
		archive.name !== archiveName ||
		archiveSize === null ||
		typeof archive.sha256 !== "string" ||
		!SHA256.test(archive.sha256)
	) {
		return null;
	}
	if (!Array.isArray(input.parts) || input.parts.length < 1 || input.parts.length > MAX_PARTS) {
		return null;
	}

	const parts: QwenRuntimePart[] = [];
	let total = 0;
	for (let offset = 0; offset < input.parts.length; offset += 1) {
		const raw = input.parts[offset];
		if (!raw || typeof raw !== "object") return null;
		const part = raw as Record<string, unknown>;
		const index = offset + 1;
		const name = `TDAQwenRuntime-${version}-windows-x64.zip.part${String(index).padStart(3, "0")}`;
		const size = positiveInt(part.size, MAX_PART_BYTES);
		if (
			part.index !== index ||
			part.name !== name ||
			size === null ||
			typeof part.sha256 !== "string" ||
			!SHA256.test(part.sha256)
		) {
			return null;
		}
		total += size;
		if (total > MAX_ARCHIVE_BYTES) return null;
		parts.push({ index, name, size, sha256: part.sha256 });
	}
	if (total !== archiveSize) return null;

	return {
		schema: SCHEMA,
		runtime_id: RUNTIME_ID,
		platform: PLATFORM,
		version,
		archive: { name: archiveName, size: archiveSize, sha256: archive.sha256 },
		parts,
	};
}
