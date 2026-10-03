"use client";

import { useState } from "react";
import {
	WorldFloatingChrome,
} from "@/features/world-explorer/components/world-floating-chrome";
import type {
	WorldRelationFilter,
} from "@/features/world-explorer/model";

export default function WorldFloatingChromeFixturePage() {
	const [query, setQuery] = useState("");
	const [relation, setRelation] = useState<WorldRelationFilter>("all");
	const [view, setView] = useState<"canvas" | "list">("canvas");

	return (
		<main style={{ padding: 8 }}>
			<WorldFloatingChrome
				query={query}
				onQueryChange={setQuery}
				relationFilter={relation}
				onRelationFilterChange={setRelation}
				view={view}
				onViewChange={setView}
				onReset={() => undefined}
				resetLabel="Reorganizar"
				demo
				activeRelationTypes={[]}
				conductor={
					<section data-testid="fixture-conductor" aria-label="Condução sintética">
						<button type="button">Ação de condução</button>
					</section>
				}
			/>
			<div
				data-testid="fixture-map"
				style={{ minHeight: "55dvh", border: "1px solid currentColor" }}
			/>
		</main>
	);
}
