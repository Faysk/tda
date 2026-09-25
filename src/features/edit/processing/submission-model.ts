import type {
	TranscriptionProfileId,
	TranscriptionProfileState,
} from "./protocol";

export const LAST_SESSION_STORAGE_KEY = "tda.processing.lastSessionId";

export function validSessionId(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export function validateCraigFileMeta(
	name: string,
	size: number,
	count = 1,
): string | null {
	if (count !== 1) return "Escolha exatamente um ZIP exportado pelo Craig.";
	if (!name.toLowerCase().endsWith(".zip"))
		return "O arquivo precisa ter extensão .zip.";
	if (!Number.isFinite(size) || size <= 0)
		return "O ZIP selecionado está vazio.";
	return null;
}

export function formatLocalBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "—";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = unit === 0 || value >= 10 ? 0 : 1;
	return `${value.toFixed(digits)} ${units[unit]}`;
}

export function profileEngineLabel(
	engine: TranscriptionProfileState["engine"],
): string {
	return engine === "qwen3" ? "Qwen3-ASR" : "Whisper";
}

export function profileModeLabel(profile: TranscriptionProfileId): string {
	if (profile.endsWith("-quality")) return "qualidade";
	if (profile.endsWith("-detailed")) return "detalhado";
	if (profile.endsWith("-fast")) return "rápido";
	return "turbo";
}

export function safeStoredSession(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	return validSessionId(trimmed) ? trimmed : null;
}
