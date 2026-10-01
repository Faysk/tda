import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
	return readFileSync(path, "utf8");
}

function assertIncludes(path, expectations) {
	const source = read(path);
	for (const [pattern, message] of expectations) {
		assert.match(source, pattern, `${path}: ${message}`);
	}
	return source;
}

function assertExcludes(path, expectations) {
	const source = read(path);
	for (const [pattern, message] of expectations) {
		assert.doesNotMatch(source, pattern, `${path}: ${message}`);
	}
	return source;
}

const globalLoading = read("src/components/global-loading/global-loading.tsx");
const selectorMatch = globalLoading.match(
	/const GLOBAL_BLOCKING_SELECTOR = ([^;]+);/u,
);
assert.ok(selectorMatch, "Global loading selector contract is missing.");
const selector = selectorMatch[1] ?? "";

assert.match(
	selector,
	/data-global-loading/u,
	"Global overlay must keep an explicit data-global-loading trigger.",
);
assert.doesNotMatch(
	selector,
	/aria-busy/u,
	"Local aria-busy must never become a global overlay selector.",
);
assert.doesNotMatch(
	selector,
	/data-state/u,
	"Feature data-state must never become a global overlay selector.",
);

const formBridge = read("src/components/global-loading/form-loading-bridge.tsx");
assert.match(
	formBridge,
	/(?:data-global-loading-submit|globalLoadingSubmit)/u,
	"Native form global loading must remain explicit opt-in.",
);

const publicLink = read("src/components/public-link.tsx");
assert.match(
	publicLink,
	/globalLoading/u,
	"PublicLink must keep route-global loading explicit.",
);

const button = read("src/components/ui/button.tsx");
assert.match(button, /pending\?: boolean/u, "Shared Button must expose local pending state.");
assert.match(button, /aria-busy=\{pending/u, "Pending Button must remain regionally busy.");

const progress = read("src/components/ui/progress.tsx");
assert.match(
	progress,
	/value !== undefined/u,
	"Progress must distinguish determinate from indeterminate by factual value presence.",
);
assert.match(
	progress,
	/data-progress-mode/u,
	"Progress must expose its mode for browser contracts.",
);
assert.match(
	progress,
	/tone = "neutral"/u,
	"Progress must default to a neutral semantic tone.",
);

/*
 * Product representatives. These are intentionally high-signal invariants,
 * not a regex reimplementation of the UI. The browser suites prove behavior;
 * this guard keeps the actual product wiring from silently drifting back to
 * global loading or ad-hoc feedback.
 */
assertIncludes("src/features/edit/transcript/editor.tsx", [
	[/pending=\{editor\.phase === "saving"\}/u, "transcript save must stay locally pending"],
	[/pendingLabel="Salvando…"/u, "transcript save must keep a factual pending label"],
]);

assertIncludes("src/features/lembra/components/lembra-experience.tsx", [
	[/<Progress/u, "Lembra upload must use the shared Progress primitive"],
	[/uploadStatus\.phase === "uploading"/u, "Lembra must preserve a factual upload phase"],
	[/uploadStatus\.phase === "finalizing"/u, "Lembra must separate finalize from upload progress"],
	[/className=\{styles\.visuallyHidden\}[\s\S]{0,160}role="status"/u, "Lembra upload stage changes must use a dedicated polite live region"],
]);
assertIncludes("src/features/lembra/components/lembra-experience.tsx", [
	[/className=\{styles\.uploadStatus\}\s+data-phase=\{uploadStatus\.phase\}\s*>/u, "Lembra numeric progress container must stay outside the live region"],
]);
assertExcludes("src/features/lembra/components/lembra-experience.tsx", [
	[/data-global-loading="true"/u, "Lembra local work must not opt into the global overlay"],
]);

assertIncludes("src/features/world-explorer/components/world-entity-media-editor.tsx", [
	[/aria-busy=\{busy\}/u, "World portrait busy state must remain regional"],
	[/<Progress/u, "World portrait upload must use the shared Progress primitive"],
	[/setUploadPhase\("finalizing"\)/u, "World portrait finalize must remain a distinct stage"],
	[/className=\{styles\.visuallyHidden\}[\s\S]{0,160}role="status"/u, "World upload stage changes must use a dedicated polite live region"],
]);
assertIncludes("src/features/world-explorer/components/world-entity-media-editor.tsx", [
	[/className=\{styles\.operationStatus\}\s+data-phase=\{uploadPhase\}\s*>/u, "World numeric chunk progress must stay outside the live region"],
]);
assertExcludes("src/features/world-explorer/components/world-entity-media-editor.tsx", [
	[/data-global-loading="true"/u, "World portrait upload must not opt into the global overlay"],
]);

assertIncludes("src/features/edit/sessions/session-cover-editor.tsx", [
	[/onUploadStateChange\?/u, "session cover must report upload state to its parent"],
	[/<Progress/u, "session cover must use the shared Progress primitive"],
]);
assertIncludes("src/features/edit/sessions/editorial-draft-editor.tsx", [
	[/coverUploadPending/u, "session publication readiness must observe cover upload state"],
	[/!coverUploadPending/u, "publish readiness must fail closed while cover media is in flight"],
]);

assertIncludes("src/features/edit/processing/panel.tsx", [
	[/data-global-loading="off"/u, "Processing workspace must remain shielded from global overlay promotion"],
	[/<AnimatedProgress/u, "Processing must keep factual item/track progress"],
]);

assertIncludes("src/app/edit/revisao/page.tsx", [
	[/FormSubmitButton/u, "review decision must use the shared pending form control"],
	[/pendingLabel="Registrando…"/u, "review decision must expose contextual pending copy"],
]);

assertIncludes("src/features/edit/sessions/session-library-page.tsx", [
	[/from "next\/form"/u, "campaign-scoped session filters must use client-side Next Form navigation"],
	[/pendingLabel="Aplicando…"/u, "campaign-scoped session filters must expose local pending feedback"],
]);

console.log(
	"ASYNC_FEEDBACK_CONTRACT_OK global=explicit forms=explicit pending=local progress=typed product-representatives=guarded",
);
