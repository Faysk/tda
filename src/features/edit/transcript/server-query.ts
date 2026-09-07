import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { queryTranscriptPage, type TranscriptPageRequest } from "./query";
import { readTranscriptPage } from "./repository";

export async function getTranscriptPageForEdit(request: TranscriptPageRequest) {
	try {
		return await queryTranscriptPage(request, {
			resolveAccessContext: loadEditAccessContext,
			readPage: readTranscriptPage,
		});
	} catch {
		return { ok: false, reason: "dependency_unavailable" } as const;
	}
}
