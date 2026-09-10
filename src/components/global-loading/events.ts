export const GLOBAL_LOADING_START_EVENT = "tda:global-loading-start";
export const GLOBAL_LOADING_STOP_EVENT = "tda:global-loading-stop";

export type GlobalLoadingEventDetail = Readonly<{
	id: string;
}>;

let sequence = 0;

function nextLoadingId(): string {
	sequence += 1;
	return `loading-${Date.now()}-${sequence}`;
}

export function beginGlobalLoadingEvent(): () => void {
	if (typeof window === "undefined") return () => undefined;

	const id = nextLoadingId();
	window.dispatchEvent(
		new CustomEvent<GlobalLoadingEventDetail>(GLOBAL_LOADING_START_EVENT, {
			detail: { id },
		}),
	);

	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		window.dispatchEvent(
			new CustomEvent<GlobalLoadingEventDetail>(GLOBAL_LOADING_STOP_EVENT, {
				detail: { id },
			}),
		);
	};
}

export function beginInteractiveGlobalLoading(): () => void {
	if (
		typeof navigator === "undefined" ||
		navigator.userActivation?.isActive !== true
	) {
		return () => undefined;
	}

	return beginGlobalLoadingEvent();
}
