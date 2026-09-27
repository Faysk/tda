import {
	QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION,
	supportsQwenAlignmentRuntime,
} from "./compatibility";

export const QWEN_RUNTIME_STABLE_MANIFEST_PATH =
	"/api/downloads/companion/windows/qwen-runtime/manifest";

export type QwenRuntimeReleaseAvailability =
	| {
			state: "available";
			stableVersion: string;
	  }
	| {
			state: "unavailable";
			stableVersion: string;
	  }
	| {
			state: "unknown";
			stableVersion: null;
	  };

type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export function classifyQwenRuntimeReleaseManifest(
	value: unknown,
): QwenRuntimeReleaseAvailability {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { state: "unknown", stableVersion: null };
	}
	const row = value as Record<string, unknown>;
	if (
		row.channel !== "stable" ||
		row.runtime_id !== "qwen3-transformers" ||
		typeof row.version !== "string" ||
		!/^\d+\.\d+\.\d+$/u.test(row.version)
	) {
		return { state: "unknown", stableVersion: null };
	}
	return {
		state: supportsQwenAlignmentRuntime(row.version)
			? "available"
			: "unavailable",
		stableVersion: row.version,
	};
}

export async function fetchQwenRuntimeReleaseAvailability(
	signal?: AbortSignal,
	request: FetchLike = fetch,
): Promise<QwenRuntimeReleaseAvailability> {
	try {
		const response = await request(QWEN_RUNTIME_STABLE_MANIFEST_PATH, {
			method: "GET",
			headers: { Accept: "application/json" },
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error",
			signal,
		});
		if (!response.ok) return { state: "unknown", stableVersion: null };
		return classifyQwenRuntimeReleaseManifest(await response.json());
	} catch {
		return { state: "unknown", stableVersion: null };
	}
}

export function qwenRuntimeReleaseMessage(
	availability: QwenRuntimeReleaseAvailability | "checking" | null,
): string {
	if (availability === "checking" || availability === null) {
		return `O Qwen requer o runtime ${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente. Verificando se uma atualização compatível já foi publicada…`;
	}
	if (availability.state === "available") {
		return `O Qwen local precisa do runtime ${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente para recuperar com segurança extrapolações de alinhamento. O canal Stable já oferece ${availability.stableVersion}; atualize o runtime/Companion antes de iniciar esta transcrição.`;
	}
	if (availability.state === "unavailable") {
		return `O Qwen requer o runtime ${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente, mas o canal Stable ainda publica ${availability.stableVersion}. O Qwen está temporariamente indisponível até uma atualização compatível ser publicada.`;
	}
	return `O Qwen requer o runtime ${QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION} ou mais recente, mas não foi possível confirmar se uma atualização compatível já está publicada. O Qwen permanece bloqueado até essa disponibilidade ser verificada.`;
}

export function qwenRuntimeReleaseLabel(
	availability: QwenRuntimeReleaseAvailability | "checking" | null,
): string {
	if (availability === "checking" || availability === null)
		return "verificando atualização";
	if (availability.state === "available") return "atualizar runtime";
	if (availability.state === "unavailable")
		return "temporariamente indisponível";
	return "disponibilidade não confirmada";
}
