import type {
	TranscriptionProfileId,
	TranscriptionProfileState,
} from "./protocol";

export const CRAIG_UPLOAD_MAX_BYTES = 64 * 1024 ** 3;

const profileLabels: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detalhado",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

export function submissionProfileLabel(id: TranscriptionProfileId): string {
	return profileLabels[id];
}

export function submissionEngineLabel(
	profile: TranscriptionProfileState,
): string {
	return profile.engine === "qwen3" ? "Qwen3-ASR" : "Whisper";
}

export function suggestSessionIdFromFilename(filename: string): string {
	const withoutExtension = filename.replace(/\.zip$/iu, "");
	const ascii = withoutExtension
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "");
	return ascii
		.replace(/[^A-Za-z0-9_-]+/gu, "-")
		.replace(/[-_]{2,}/gu, "-")
		.replace(/^[-_]+|[-_]+$/gu, "")
		.slice(0, 128);
}

export function validateCraigFile(
	file: Pick<File, "name" | "size">,
): string | null {
	if (!file.name.toLocaleLowerCase("en-US").endsWith(".zip"))
		return "Escolha um arquivo .zip exportado pelo Craig.";
	if (file.size <= 0) return "O ZIP selecionado está vazio.";
	if (file.size > CRAIG_UPLOAD_MAX_BYTES)
		return "O ZIP ultrapassa o limite local de 64 GiB.";
	return null;
}

export function formatSubmissionBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "—";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function profileReadinessCopy(
	profile: TranscriptionProfileState | null,
): string | null {
	if (!profile || profile.ready) return null;
	if (profile.preparationRequired)
		return "Este profile precisa ser preparado nesta máquina antes de entrar na fila.";
	return "Este profile está indisponível neste Companion.";
}

export function submissionCtaLabel(
	profile: TranscriptionProfileState | null,
	pending:
		| null
		| "validating"
		| "preparing"
		| "submitting",
): string {
	if (pending === "validating") return "Validando ZIP…";
	if (pending === "preparing") return "Preparando profile…";
	if (pending === "submitting") return "Enviando ao Companion…";
	if (profile && !profile.ready && profile.preparationRequired)
		return "Preparar profile";
	return "Adicionar à fila";
}
