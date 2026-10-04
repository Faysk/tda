// Isolated browser harness. Never included in the Next app or used as an auth bypass.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/app/design-tokens.css";
import "../../src/app/design-system.css";
import "../../src/app/globals.css";
import { ProcessingPanel } from "../../src/features/edit/processing/panel";
import { ReviewFixture } from "./review";
import processingStyles from "../../src/features/edit/processing/processing.module.css";

class FixtureRenderBoundary extends Component<
	Readonly<{ children: ReactNode }>,
	Readonly<{ error: string | null }>
> {
	state = { error: null as string | null };

	static getDerivedStateFromError(error: unknown) {
		return { error: error instanceof Error ? error.stack ?? error.message : String(error) };
	}

	componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error("PROCESSING_FIXTURE_RENDER_ERROR", error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return <pre data-processing-fixture-render-error="true">{this.state.error}</pre>;
		}
		return this.props.children;
	}
}

const originalFetch = window.fetch.bind(window);
const fixtureParams = new URLSearchParams(location.search);

window.fetch = (input, init) => {
	const raw =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.toString()
				: input.url;
	const resolved = new URL(raw, window.location.origin);
	if (resolved.pathname === "/api/edit/processing/campaign-context") {
		const campaignContextMode = fixtureParams.get("campaign-context");
		const unavailable = campaignContextMode === "unavailable";
		return Promise.resolve(
			new Response(
				JSON.stringify(
					unavailable
						? { ok: false, reason: "campaign_unavailable" }
						: { ok: true, campaignSlug: "yuhara-main" },
				),
				{
					status: unavailable ? 409 : 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
	}

	// The integrated test selects a separate scratch service; real product endpoint stays fixed.
	const target =
		fixtureParams.has("integrated") && typeof input === "string"
			? input.replace("http://127.0.0.1:8765/", "http://127.0.0.1:18765/")
			: input;
	return originalFetch(target, init);
};
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<FixtureRenderBoundary>
	<main className={processingStyles.page} data-processing-workspace="true">
		<h1
			style={{
				position: "absolute",
				width: 1,
				height: 1,
				padding: 0,
				margin: -1,
				overflow: "hidden",
				clip: "rect(0 0 0 0)",
				whiteSpace: "nowrap",
				border: 0,
			}}
		>
			Processamento
		</h1>
		{fixtureParams.has("review-contracts") ? (
			<ReviewFixture />
		) : (
			<ProcessingPanel
				campaignId="yuhara-main"
				campaignName="Crônicas da Mesa"
				campaignOptions={[
					{
						technicalSlug: "yuhara-main",
						name: "Crônicas da Mesa",
						routeKey: "cronicas-da-mesa",
					},
					{
						technicalSlug: "antes-que-seja-tarde",
						name: "Antes que seja tarde",
						routeKey: "antes-que-seja-tarde",
					},
				]}
				activityPackScope="fixture-profile:yuhara-main"
				publicationEnabled={fixtureParams.has("publication")}
			/>
		)}
	</main>
	</FixtureRenderBoundary>,
);
