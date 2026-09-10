"use client";

import { useEffect, useMemo, useState } from "react";
import { worldDatasetFromDraft } from "../graph-contract";
import type {
	WorldFilter,
	WorldGraphDraft,
	WorldGraphProjection,
	WorldRelationFilter,
} from "../model";
import {
	buildWorldProjection,
	filterWorldProjection,
	filterWorldRelations,
	searchWorldProjection,
} from "../projection";

export type WorldExplorerViewMode = "canvas" | "list";

export function projectionWithWorldDraft(
	projection: WorldGraphProjection,
	draft: WorldGraphDraft | null,
): WorldGraphProjection {
	if (!draft) return projection;
	const next = buildWorldProjection(worldDatasetFromDraft(draft));
	next.layout = projection.layout;
	return next;
}

type UseWorldExplorerViewOptions = Readonly<{
	projection: WorldGraphProjection;
	canEditContent: boolean;
	editing: boolean;
	graphDraft: WorldGraphDraft | null;
}>;

export function useWorldExplorerView({
	projection,
	canEditContent,
	editing,
	graphDraft,
}: UseWorldExplorerViewOptions) {
	const [filter, setFilter] = useState<WorldFilter>("all");
	const [relationFilter, setRelationFilter] = useState<WorldRelationFilter>("all");
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(projection.focusId);
	const [view, setView] = useState<WorldExplorerViewMode>("canvas");

	const workingProjection = useMemo(() => {
		if (!canEditContent || !editing || !graphDraft) return projection;
		return projectionWithWorldDraft(projection, graphDraft);
	}, [canEditContent, editing, graphDraft, projection]);

	const visibleProjection = useMemo(() => {
		const byType = filterWorldProjection(workingProjection, filter);
		const byRelation = filterWorldRelations(byType, relationFilter);
		return searchWorldProjection(byRelation, query);
	}, [workingProjection, filter, relationFilter, query]);

	useEffect(() => {
		if (selectedId && !visibleProjection.nodes.some((node) => node.id === selectedId)) {
			setSelectedId(null);
		}
	}, [selectedId, visibleProjection.nodes]);

	const selected = selectedId
		? visibleProjection.nodes.find((node) => node.id === selectedId)
		: undefined;
	const focus = workingProjection.focusId
		? workingProjection.nodes.find((node) => node.id === workingProjection.focusId)
		: undefined;
	const activeRelationTypes = workingProjection.relationTypes.filter((type) => type.isActive);

	return {
		filter,
		setFilter,
		relationFilter,
		setRelationFilter,
		query,
		setQuery,
		selectedId,
		setSelectedId,
		view,
		setView,
		workingProjection,
		visibleProjection,
		selected,
		focus,
		activeRelationTypes,
	} as const;
}
