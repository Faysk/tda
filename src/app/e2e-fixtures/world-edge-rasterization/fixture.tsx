import { WorldExplorerClient } from "@/features/world-explorer/components/world-explorer-client";
import { WORLD_RELATION_STRESS_FIXTURE } from "@/features/world-explorer/fixtures/relation-stress";
import { WorldWorkspaceShell } from "@/features/world-shell/world-workspace-shell";

export function WorldEdgeRasterizationFixture({
	editable,
}: {
	editable: boolean;
}) {
	const href = editable
		? "/e2e-fixtures/world-edge-rasterization/edit"
		: "/e2e-fixtures/world-edge-rasterization/public";

	return (
		<WorldWorkspaceShell>
			<WorldExplorerClient
				projection={WORLD_RELATION_STRESS_FIXTURE}
				campaignSlug="fixture-world"
				campaignName={editable ? "Fixture Edit" : "Fixture Public"}
				campaignWorldHref={href}
				campaignSwitchOptions={[
					{
						key: "fixture-world",
						name: editable ? "Fixture Edit" : "Fixture Public",
						href,
						current: true,
					},
				]}
				canEditLayout={editable}
				canEditContent={editable}
			/>
		</WorldWorkspaceShell>
	);
}
