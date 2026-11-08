export type StoryBlock =
	| Readonly<{ type: "heading"; level: number; text: string }>
	| Readonly<{ type: "paragraph"; text: string }>
	| Readonly<{ type: "quote"; text: string }>
	| Readonly<{ type: "list"; ordered: boolean; items: readonly string[] }>
	| Readonly<{ type: "rule" }>
	| Readonly<{ type: "image"; alt: string; src: string; title?: string }>;

function normalizeLines(source: string) {
	return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function stripFrontmatter(lines: string[]) {
	if (lines[0]?.trim() !== "---") return lines;

	const max = Math.min(lines.length, 80);
	for (let index = 1; index < max; index += 1) {
		if (lines[index]?.trim() !== "---") continue;
		const candidate = lines.slice(1, index);
		const looksLikeFrontmatter = candidate.some((line) =>
			/^[A-Za-z0-9_-]+:\s*/.test(line.trim()),
		);
		if (looksLikeFrontmatter) return lines.slice(index + 1);
		break;
	}

	return lines;
}

function paragraphText(lines: readonly string[]) {
	let result = "";
	for (const rawLine of lines) {
		const hardBreak = /\s{2,}$/.test(rawLine);
		const line = rawLine.trim();
		if (!line) continue;
		if (result && !result.endsWith("\n")) result += " ";
		result += line;
		if (hardBreak) result += "\n";
	}
	return result.trim();
}

/**
 * Only immutable session illustrations in the TDA public R2 namespace may be
 * embedded. A draft's own private preview uses an authenticated server route.
 * External Markdown URLs are displayed as text instead of causing third-party
 * image requests or becoming dynamic navigation destinations.
 */
export function safeStoryImageUrl(raw: string): string | null {
	const match = /^https:\/\/media\.dnd\.faysk\.dev\/campaigns\/([a-z0-9][a-z0-9-]{0,95})\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/inline\/([a-f0-9]{64})\.(png|webp)$/u.exec(raw);
	if (!match) return null;
	const [, campaign, session, sha256, extension] = match;
	return "https://media.dnd.faysk.dev/campaigns/" + campaign +
		"/sessions/" + session + "/inline/" + sha256 + "." + extension;
}

function imageLine(line: string): Extract<StoryBlock, { type: "image" }> | null {
	const match = /^!\[([^\]\n]+)\]\((https:\/\/[^\s)]+)(?:\s+"([^"\n]+)")?\)$/u.exec(line.trim());
	const src = match ? safeStoryImageUrl(match[2] ?? "") : null;
	if (!match || !src) return null;
	return {
		type: "image",
		alt: match[1] ?? "",
		src,
		...(match[3] ? { title: match[3] } : {}),
	};
}

function isRule(line: string) {
	const compact = line.trim().replaceAll(" ", "");
	return compact === "---" || compact === "***" || compact === "___";
}

export function parseStoryMarkdown(source: string): StoryBlock[] {
	const lines = stripFrontmatter(normalizeLines(source));
	const blocks: StoryBlock[] = [];
	let index = 0;

	const pushParagraph = (paragraphLines: string[]) => {
		const text = paragraphText(paragraphLines);
		if (text) blocks.push({ type: "paragraph", text });
	};

	while (index < lines.length) {
		const line = lines[index] ?? "";
		const trimmed = line.trim();
		if (!trimmed) {
			index += 1;
			continue;
		}

		if (isRule(line)) {
			blocks.push({ type: "rule" });
			index += 1;
			continue;
		}

		const image = imageLine(line);
		if (image) {
			blocks.push(image);
			index += 1;
			continue;
		}

		const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (heading) {
			blocks.push({
				type: "heading",
				level: heading[1]?.length ?? 1,
				text: heading[2]?.trim() ?? "",
			});
			index += 1;
			continue;
		}

		if (/^\s*>/.test(line)) {
			const quoteLines: string[] = [];
			while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) {
				quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
				index += 1;
			}
			const text = paragraphText(quoteLines);
			if (text) blocks.push({ type: "quote", text });
			continue;
		}

		const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
		if (unordered) {
			const items: string[] = [];
			while (index < lines.length) {
				const match = (lines[index] ?? "").match(/^\s*[-*+]\s+(.+)$/);
				if (!match) break;
				items.push(match[1]?.trim() ?? "");
				index += 1;
			}
			blocks.push({ type: "list", ordered: false, items });
			continue;
		}

		const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
		if (ordered) {
			const items: string[] = [];
			while (index < lines.length) {
				const match = (lines[index] ?? "").match(/^\s*\d+[.)]\s+(.+)$/);
				if (!match) break;
				items.push(match[1]?.trim() ?? "");
				index += 1;
			}
			blocks.push({ type: "list", ordered: true, items });
			continue;
		}

		const paragraphLines: string[] = [];
		while (index < lines.length) {
			const current = lines[index] ?? "";
			if (!current.trim()) break;
			if (paragraphLines.length > 0) {
				if (isRule(current) || imageLine(current)) break;
				if (/^\s*#{1,6}\s+/.test(current)) break;
				if (/^\s*>/.test(current)) break;
				if (/^\s*[-*+]\s+/.test(current)) break;
				if (/^\s*\d+[.)]\s+/.test(current)) break;
			}
			paragraphLines.push(current);
			index += 1;
		}
		pushParagraph(paragraphLines);
	}

	return blocks;
}
