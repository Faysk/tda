import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
	return readFileSync(path, "utf8");
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

console.log(
	"ASYNC_FEEDBACK_CONTRACT_OK global=explicit forms=explicit pending=local progress=typed",
);
