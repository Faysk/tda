import { parseStoryMarkdown, type StoryBlock } from "./story-markdown";

export type StoryOutlineEntry = Readonly<{
	blockIndex: number;
	id: string;
	level: number;
	text: string;
}>;

export function storyHeadingText(value: string) {
	return value
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/\*(.*?)\*/g, "$1")
		.replace(/_(.*?)_/g, "$1")
		.replace(/`(.*?)`/g, "$1")
		.trim();
}

export function normalizeStoryHeading(value: string) {
	return storyHeadingText(value).toLocaleLowerCase("pt-BR");
}

function headingSlug(value: string) {
	const slug = storyHeadingText(value)
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-BR")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "trecho";
}

export function storyOutlineFromBlocks(
	blocks: readonly StoryBlock[],
	title: string,
): readonly StoryOutlineEntry[] {
	const normalizedTitle = normalizeStoryHeading(title);
	const used = new Set<string>();
	const entries: StoryOutlineEntry[] = [];

	blocks.forEach((block, blockIndex) => {
		if (block.type !== "heading") return;
		if (
			blockIndex === 0 &&
			block.level === 1 &&
			normalizeStoryHeading(block.text) === normalizedTitle
		) {
			return;
		}

		const base = `secao-${headingSlug(block.text)}`;
		let id = base;
		let suffix = 2;
		while (used.has(id)) {
			id = `${base}-${suffix}`;
			suffix += 1;
		}
		used.add(id);
		entries.push({
			blockIndex,
			id,
			level: block.level,
			text: storyHeadingText(block.text),
		});
	});

	return entries;
}

export function buildStoryOutline(source: string, title: string) {
	const blocks = parseStoryMarkdown(source);
	return {
		blocks,
		outline: storyOutlineFromBlocks(blocks, title),
	};
}
