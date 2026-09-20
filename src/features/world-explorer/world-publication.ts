import type { WorldPublicationMeta } from "./model";

export function worldPublicationVersionLabel(
	publication: Pick<WorldPublicationMeta, "graphRevision" | "layoutRevision">,
): string {
	const graph = String(publication.graphRevision).padStart(3, "0");
	const layout = String(publication.layoutRevision).padStart(3, "0");
	return `v${graph}·${layout}`;
}
