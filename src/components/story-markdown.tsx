import type { ReactNode } from "react";
import Image from "next/image";
import {
	parseStoryMarkdown,
	type StoryBlock,
} from "@/features/sessions/story-markdown";
import {
	normalizeStoryHeading,
	storyOutlineFromBlocks,
} from "@/features/sessions/story-outline";

function renderInline(source: string): ReactNode[] {
	const parts = source.split(
		/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\n)/g,
	);
	return parts.filter(Boolean).map((part, index) => {
		const key = `${index}-${part.slice(0, 16)}`;
		if (part === "\n") return <br key={key} />;
		if (part.startsWith("**") && part.endsWith("**")) {
			return <strong key={key}>{part.slice(2, -2)}</strong>;
		}
		if (part.startsWith("`") && part.endsWith("`")) {
			return <code key={key}>{part.slice(1, -1)}</code>;
		}
		if (
			(part.startsWith("*") && part.endsWith("*")) ||
			(part.startsWith("_") && part.endsWith("_"))
		) {
			return <em key={key}>{part.slice(1, -1)}</em>;
		}
		return part;
	});
}

function keyedListItems(items: readonly string[]) {
	const occurrences = new Map<string, number>();
	return items.map((item) => {
		const occurrence = (occurrences.get(item) ?? 0) + 1;
		occurrences.set(item, occurrence);
		return { item, key: `${item}\u0000${occurrence}` };
	});
}

function StoryHeading({
	block,
	id,
}: {
	block: Extract<StoryBlock, { type: "heading" }>;
	id?: string;
}) {
	const content = renderInline(block.text);
	const props = id ? { id, tabIndex: -1, "data-story-section": true } : {};
	switch (block.level) {
		case 1:
			return <h2 {...props}>{content}</h2>;
		case 2:
			return <h3 {...props}>{content}</h3>;
		case 3:
			return <h4 {...props}>{content}</h4>;
		case 4:
			return <h5 {...props}>{content}</h5>;
		default:
			return <h6 {...props}>{content}</h6>;
	}
}

export function StoryMarkdown({
	source,
	title,
	previewSessionId,
}: {
	source: string;
	title: string;
	previewSessionId?: string;
}) {
	const blocks = parseStoryMarkdown(source);
	const normalizedTitle = normalizeStoryHeading(title);
	const outlineByBlock = new Map(
		storyOutlineFromBlocks(blocks, title).map((entry) => [
			entry.blockIndex,
			entry.id,
		]),
	);

	return (
		<div className="story-content">
			{blocks.map((block, index) => {
				const key = `${block.type}-${index}`;
				if (
					index === 0 &&
					block.type === "heading" &&
					block.level === 1 &&
					normalizeStoryHeading(block.text) === normalizedTitle
				) {
					return null;
				}

				switch (block.type) {
					case "heading":
						return <StoryHeading block={block} id={outlineByBlock.get(index)} key={key} />;
					case "paragraph":
						return <p key={key}>{renderInline(block.text)}</p>;
					case "quote":
						return (
							<blockquote key={key}>{renderInline(block.text)}</blockquote>
						);
					case "list": {
						const List = block.ordered ? "ol" : "ul";
						return (
							<List key={key}>
								{keyedListItems(block.items).map(({ item, key: itemKey }) => (
									<li key={itemKey}>{renderInline(item)}</li>
								))}
							</List>
						);
					}
					case "image": {
						// An editorial-only reference permits private previews before promotion.
						const assetId = /^tda-inline:([0-9a-f-]{36})$/iu.exec(block.title ?? "")?.[1];
						const src = previewSessionId && assetId
							? "/api/edit/session-inline/" + encodeURIComponent(previewSessionId) + "/" + encodeURIComponent(assetId)
							: block.src;
						return (
							<figure className="story-illustration" key={key}>
								<details>
									<summary aria-label={"Ampliar ou reduzir ilustração: " + block.alt}>
										<Image alt={block.alt} src={src} width={1200} height={800} sizes="(max-width: 700px) 100vw, 880px" unoptimized />
									</summary>
									<div className="story-illustration-expanded">
										<Image alt={block.alt} src={src} width={1600} height={1200} sizes="(max-width: 700px) 100vw, 880px" unoptimized />
									</div>
								</details>
							</figure>
						);
					}
					case "rule":
						return <hr key={key} />;
					default:
						return null;
				}
			})}
		</div>
	);
}
