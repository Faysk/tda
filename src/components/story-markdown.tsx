import type { ReactNode } from "react";
import {
	parseStoryMarkdown,
	type StoryBlock,
} from "@/features/sessions/story-markdown";

function normalizeHeading(value: string) {
	return value
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/\*(.*?)\*/g, "$1")
		.replace(/_(.*?)_/g, "$1")
		.replace(/`(.*?)`/g, "$1")
		.trim()
		.toLocaleLowerCase("pt-PT");
}

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

function StoryHeading({
	block,
}: {
	block: Extract<StoryBlock, { type: "heading" }>;
}) {
	const content = renderInline(block.text);
	switch (block.level) {
		case 1:
			return <h2>{content}</h2>;
		case 2:
			return <h3>{content}</h3>;
		case 3:
			return <h4>{content}</h4>;
		case 4:
			return <h5>{content}</h5>;
		default:
			return <h6>{content}</h6>;
	}
}

export function StoryMarkdown({ source, title }: { source: string; title: string }) {
	const blocks = parseStoryMarkdown(source);
	const normalizedTitle = normalizeHeading(title);

	return (
		<div className="story-content">
			{blocks.map((block, index) => {
				const key = `${block.type}-${index}`;
				if (
					index === 0 &&
					block.type === "heading" &&
					block.level === 1 &&
					normalizeHeading(block.text) === normalizedTitle
				) {
					return null;
				}

				switch (block.type) {
					case "heading":
						return <StoryHeading block={block} key={key} />;
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
								{block.items.map((item) => (
									<li key={item}>{renderInline(item)}</li>
								))}
							</List>
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
