import {
	QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION,
	supportsQwenAlignmentRuntime,
} from "./compatibility";

export const QWEN_RUNTIME_STABLE_MANIFEST_PATH =
	"/api/downloads/companion/windows/qwen-runtime/manifest";

export type QwenRuntimeReleaseAvailability =
	| Readonly<{ status: "compatible"; version: string }>
	| Readonly<{ status: "below-minimum"; version: string }>
	| Readonly<{ status: "unknown"; version: null }>;

function stableManifestVersion(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (row.channel !== "stable" || row.runtime_id !== "qwen3-transformers")
		return null;
	if (typeof row.version !== "string") return null;
	const version = row.version.trim();
	return /^\d+\.\d+\.\d+$/u.test(version) ? version : null;
}

export function classifyQwenRuntimeReleaseAvailability(
	value: unknown,
): QwenRuntimeReleaseAvailability {
	const version = stableManifestVersion(value);
	if (!version) return { status: "unknown", version: null };
	return supportsQwenAlignmentRuntime(version)
		? { status: "compatible", version }
		: { status: "below-minimum", version };
}

export async function fetchQwenRuntimeReleaseAvailability(
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<QwenRuntimeReleaseAvailability> {
	try {
		const response = await fetcher(QWEN_RUNTIME_STABLE_MANIFEST_PATH, {
			method: "GET",
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error",
			referrerPolicy: "no-referrer",
			signal,
		});
		if (!response.ok) return { status: "unknown", version: null };
		return classifyQwenRuntimeReleaseAvailability(await response.json());
	} catch {
		return { status: "unknown", version: null };
	}
}

export function qwenRuntimeAvailabilityMessage(
	availability: QwenRuntimeReleaseAvailability | null,
): string {
	if (!availability) {
		return `Verificando se já existe um runtime Qwen Stable compatível com o mínimo v${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION}…`;
	}
	if (availability.status === "compatible") {
		return `Runtime Qwen Stable v${availability.version} disponível. O runtime local precisa de v${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente para este fluxo. Atualize o runtime Qwen pelo Companion antes de iniciar esta transcrição.`;
	}
	if (availability.status === "below-minimum") {
		return `Qwen temporariamente indisponível: o Stable publicado ainda é v${availability.version}, abaixo do mínimo v${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} exigido por esta tela. O processamento Qwen permanece bloqueado até uma versão compatível ser publicada.`;
	}
	return `A disponibilidade do runtime Qwen Stable não pôde ser confirmada agora. Esta tela exige v${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente e mantém o Qwen bloqueado até conseguir verificar uma versão compatível.`;
}

export function qwenRuntimeAvailabilitySuffix(
	availability: QwenRuntimeReleaseAvailability | null,
): string {
	if (!availability) return " · verificando runtime";
	if (availability.status === "compatible") return " · atualizar runtime";
	if (availability.status === "below-minimum")
		return " · temporariamente indisponível";
	return " · disponibilidade não confirmada";
}
