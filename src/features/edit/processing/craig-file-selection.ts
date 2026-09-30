import type { CraigSource } from "./protocol";
import { validateCraigFile } from "./submission-model";

export type CraigFileState =
	| "selected"
	| "validating"
	| "valid"
	| "duplicate"
	| "invalid"
	| "error";

export type CraigFileSelection = Readonly<{
	id: string;
	file: File;
	state: CraigFileState;
	error: string | null;
	source: CraigSource | null;
}>;

export function appendCraigFiles(
	current: readonly CraigFileSelection[],
	files: readonly File[],
	createId: () => string = () => crypto.randomUUID(),
): CraigFileSelection[] {
	return [
		...current,
		...files.map((file) => {
			const validation = validateCraigFile(file);
			return {
				id: createId(),
				file,
				state: validation ? ("invalid" as const) : ("selected" as const),
				error: validation,
				source: null,
			};
		}),
	];
}

export function replaceCraigFileSelection(
	current: readonly CraigFileSelection[],
	id: string,
	patch: Partial<Omit<CraigFileSelection, "id" | "file">>,
): CraigFileSelection[] {
	return current.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function removeCraigFileSelection(
	current: readonly CraigFileSelection[],
	id: string,
): CraigFileSelection[] {
	return current.filter((item) => item.id !== id);
}

export function stageableCraigFiles(
	current: readonly CraigFileSelection[],
): readonly CraigFileSelection[] {
	return current.filter(
		(item) =>
			item.state === "selected" ||
			item.state === "error" ||
			item.state === "valid" ||
			item.state === "duplicate",
	);
}

export function markExactSourceDuplicates(
	current: readonly CraigFileSelection[],
): CraigFileSelection[] {
	const first = new Map<string, string>();
	return current.map((item) => {
		if (!item.source || (item.state !== "valid" && item.state !== "duplicate"))
			return item;
		const owner = first.get(item.source.sourceId);
		if (!owner) {
			first.set(item.source.sourceId, item.id);
			return item.state === "duplicate"
				? { ...item, state: "valid", error: null }
				: item;
		}
		return {
			...item,
			state: "duplicate",
			error: "Este ZIP é uma duplicata exata de outra gravação já selecionada.",
		};
	});
}

export function uniqueStagedCraigSources(
	current: readonly CraigFileSelection[],
): readonly CraigSource[] {
	const seen = new Set<string>();
	const sources: CraigSource[] = [];
	for (const item of current) {
		if (!item.source || (item.state !== "valid" && item.state !== "duplicate"))
			continue;
		if (seen.has(item.source.sourceId)) continue;
		seen.add(item.source.sourceId);
		sources.push(item.source);
	}
	return sources;
}
