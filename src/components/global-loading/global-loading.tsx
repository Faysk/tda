"use client";

import Image from "next/image";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	GLOBAL_LOADING_START_EVENT,
	GLOBAL_LOADING_STOP_EVENT,
	type GlobalLoadingEventDetail,
} from "./events";
import themeStyles from "./global-loading-theme.module.css";
import styles from "./global-loading.module.css";

type LoaderPhase = "hidden" | "active" | "leaving";
type StopLoading = () => void;

export type GlobalLoadingOptions = Readonly<{
	immediate?: boolean;
}>;

type GlobalLoadingContextValue = Readonly<{
	begin: (options?: GlobalLoadingOptions) => StopLoading;
	run: <T>(
		operation: Promise<T> | (() => Promise<T>),
		options?: GlobalLoadingOptions,
	) => Promise<T>;
}>;

const SHOW_DELAY_MS = 110;
const EXIT_DURATION_MS = 680;

const BUSY_SELECTOR = [
	'[aria-busy="true"]',
	'[data-global-loading="true"]',
	'[data-state="saving"]',
].join(",");

function hasBlockingBusyElement(): boolean {
	return [...document.querySelectorAll(BUSY_SELECTOR)].some(
		(element) => !element.closest('[data-global-loading="off"]'),
	);
}

async function runWithoutProvider<T>(
	operation: Promise<T> | (() => Promise<T>),
): Promise<T> {
	return typeof operation === "function" ? operation() : operation;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextValue>({
	begin: () => () => undefined,
	run: runWithoutProvider,
});

function readRotation(transform: string): number {
	if (!transform || transform === "none") return 0;

	const matrix3d = transform.match(/^matrix3d\((.+)\)$/u);
	if (matrix3d?.[1]) {
		const values = matrix3d[1].split(",").map(Number);
		return (Math.atan2(values[1] ?? 0, values[0] ?? 1) * 180) / Math.PI;
	}

	const matrix = transform.match(/^matrix\((.+)\)$/u);
	if (matrix?.[1]) {
		const values = matrix[1].split(",").map(Number);
		return (Math.atan2(values[1] ?? 0, values[0] ?? 1) * 180) / Math.PI;
	}

	return 0;
}

function normalizeRotation(value: number): number {
	return ((value % 360) + 360) % 360;
}

function LoaderVisual({
	phase,
	serverFallback = false,
}: Readonly<{
	phase: Exclude<LoaderPhase, "hidden">;
	serverFallback?: boolean;
}>) {
	const logoSpinRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const logo = logoSpinRef.current;
		if (!logo || phase !== "leaving") return;

		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		const current = normalizeRotation(
			readRotation(window.getComputedStyle(logo).transform),
		);
		let delta = 360 - current;
		if (delta < 120) delta += 360;
		const target = current + delta;

		for (const animation of logo.getAnimations()) animation.cancel();
		logo.style.animation = "none";
		logo.style.transform = `rotate(${current}deg)`;

		const finish = logo.animate(
			[
				{ transform: `rotate(${current}deg) scale(1)` },
				{
					transform: `rotate(${current + delta * 0.62}deg) scale(1.018)`,
					offset: 0.56,
				},
				{
					transform: `rotate(${current + delta * 0.91}deg) scale(1.008)`,
					offset: 0.84,
				},
				{ transform: `rotate(${target}deg) scale(1)` },
			],
			{
				duration: 600,
				easing: "cubic-bezier(0.1, 0.72, 0.15, 1)",
				fill: "forwards",
			},
		);

		return () => {
			finish.cancel();
			logo.style.animation = "";
			logo.style.transform = "";
		};
	}, [phase]);

	const className = [
		styles.overlay,
		themeStyles.overlay,
		phase === "leaving" ? styles.leaving : styles.active,
		serverFallback ? styles.serverFallback : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			className={className}
			data-global-loading="off"
			role="status"
			aria-busy="true"
			aria-label="Carregando"
		>
			<div className={styles.loader} aria-hidden="true">
				<div
					className={`${styles.halo} ${styles.haloOuter} ${themeStyles.haloOuter}`}
				/>
				<div
					className={`${styles.halo} ${styles.haloMid} ${themeStyles.haloMid}`}
				/>
				<div
					className={`${styles.halo} ${styles.haloCore} ${themeStyles.haloCore}`}
				/>

				<div
					className={`${styles.orbit} ${styles.orbitOne} ${themeStyles.orbitOne}`}
				>
					<i className={themeStyles.orbitPoint} />
				</div>
				<div
					className={`${styles.orbit} ${styles.orbitTwo} ${themeStyles.orbitTwo}`}
				>
					<i className={themeStyles.orbitPoint} />
				</div>
				<div
					className={`${styles.orbit} ${styles.orbitThree} ${themeStyles.orbitThree}`}
				>
					<i className={themeStyles.orbitPoint} />
				</div>

				<div
					className={`${styles.trail} ${styles.trailOne} ${themeStyles.trailOne}`}
				/>
				<div
					className={`${styles.trail} ${styles.trailTwo} ${themeStyles.trailTwo}`}
				/>

				<div className={styles.logoFrame}>
					<div className={`${styles.logoShadow} ${themeStyles.logoShadow}`} />
					<div className={styles.logoSpin} ref={logoSpinRef}>
						<Image
							className={`${styles.logoImage} ${themeStyles.logoImage}`}
							src="/brand/tda-mark-white.svg"
							alt=""
							width={176}
							height={176}
						/>
					</div>
				</div>

				<div
					className={`${styles.spark} ${styles.sparkOne} ${themeStyles.spark}`}
				/>
				<div
					className={`${styles.spark} ${styles.sparkTwo} ${themeStyles.spark}`}
				/>
				<div
					className={`${styles.spark} ${styles.sparkThree} ${themeStyles.spark}`}
				/>
				<div
					className={`${styles.spark} ${styles.sparkFour} ${themeStyles.spark}`}
				/>
			</div>
		</div>
	);
}

export function GlobalLoadingProvider({
	children,
}: Readonly<{ children: ReactNode }>) {
	const [phase, setPhaseState] = useState<LoaderPhase>("hidden");
	const phaseRef = useRef<LoaderPhase>("hidden");
	const tokens = useRef(new Set<symbol>());
	const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const setPhase = useCallback((next: LoaderPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);

	const clearShowTimer = useCallback(() => {
		if (!showTimer.current) return;
		clearTimeout(showTimer.current);
		showTimer.current = null;
	}, []);

	const clearHideTimer = useCallback(() => {
		if (!hideTimer.current) return;
		clearTimeout(hideTimer.current);
		hideTimer.current = null;
	}, []);

	const show = useCallback(() => {
		clearShowTimer();
		clearHideTimer();
		if (tokens.current.size === 0) return;
		setPhase("active");
	}, [clearHideTimer, clearShowTimer, setPhase]);

	const finishWhenIdle = useCallback(() => {
		if (tokens.current.size > 0) return;

		clearShowTimer();
		if (phaseRef.current === "hidden") return;

		clearHideTimer();
		setPhase("leaving");
		hideTimer.current = setTimeout(() => {
			hideTimer.current = null;
			if (tokens.current.size === 0) setPhase("hidden");
		}, EXIT_DURATION_MS);
	}, [clearHideTimer, clearShowTimer, setPhase]);

	const begin = useCallback(
		(options: GlobalLoadingOptions = {}): StopLoading => {
			const token = Symbol("global-loading");
			tokens.current.add(token);

			if (phaseRef.current === "leaving") {
				clearHideTimer();
				setPhase("active");
			} else if (phaseRef.current === "hidden") {
				if (options.immediate) {
					show();
				} else if (!showTimer.current) {
					showTimer.current = setTimeout(show, SHOW_DELAY_MS);
				}
			}

			let stopped = false;
			return () => {
				if (stopped) return;
				stopped = true;
				tokens.current.delete(token);
				finishWhenIdle();
			};
		},
		[clearHideTimer, finishWhenIdle, setPhase, show],
	);

	const run = useCallback(
		async function run<T>(
			operation: Promise<T> | (() => Promise<T>),
			options?: GlobalLoadingOptions,
		): Promise<T> {
			const stop = begin(options);
			try {
				return await (typeof operation === "function" ? operation() : operation);
			} finally {
				stop();
			}
		},
		[begin],
	);

	useEffect(() => {
		return () => {
			clearShowTimer();
			clearHideTimer();
			tokens.current.clear();
		};
	}, [clearHideTimer, clearShowTimer]);

	/*
	 * Shared blocking-state contract:
	 * - aria-busy=true is observed automatically;
	 * - data-global-loading=true can opt a surface in explicitly;
	 * - data-global-loading=off keeps background polling/autosave out.
	 *
	 * Existing surfaces already expose aria-busy or data-state="saving", so the
	 * visual layer remains independent from feature-specific implementations.
	 */
	useEffect(() => {
		let stopBusy: StopLoading | null = null;

		const syncBusyState = () => {
			const busy = hasBlockingBusyElement();
			if (busy && !stopBusy) {
				stopBusy = begin();
			} else if (!busy && stopBusy) {
				stopBusy();
				stopBusy = null;
			}
		};

		const observer = new MutationObserver(syncBusyState);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["aria-busy", "data-global-loading", "data-state"],
			childList: true,
			subtree: true,
		});
		syncBusyState();

		return () => {
			observer.disconnect();
			stopBusy?.();
		};
	}, [begin]);

	useEffect(() => {
		const activeEvents = new Map<string, StopLoading>();

		const onStart = (event: Event) => {
			const detail = (event as CustomEvent<GlobalLoadingEventDetail>).detail;
			if (!detail?.id || activeEvents.has(detail.id)) return;
			activeEvents.set(detail.id, begin());
		};

		const onStop = (event: Event) => {
			const detail = (event as CustomEvent<GlobalLoadingEventDetail>).detail;
			if (!detail?.id) return;
			activeEvents.get(detail.id)?.();
			activeEvents.delete(detail.id);
		};

		window.addEventListener(GLOBAL_LOADING_START_EVENT, onStart);
		window.addEventListener(GLOBAL_LOADING_STOP_EVENT, onStop);

		return () => {
			window.removeEventListener(GLOBAL_LOADING_START_EVENT, onStart);
			window.removeEventListener(GLOBAL_LOADING_STOP_EVENT, onStop);
			for (const stop of activeEvents.values()) stop();
			activeEvents.clear();
		};
	}, [begin]);

	const value = useMemo<GlobalLoadingContextValue>(
		() => ({ begin, run }),
		[begin, run],
	);

	return (
		<GlobalLoadingContext.Provider value={value}>
			{children}
			{phase === "hidden" ? null : <LoaderVisual phase={phase} />}
		</GlobalLoadingContext.Provider>
	);
}

export function useGlobalLoading(): GlobalLoadingContextValue {
	return useContext(GlobalLoadingContext);
}

export function useGlobalLoadingFlag(
	active: boolean,
	options?: GlobalLoadingOptions,
) {
	const { begin } = useGlobalLoading();
	const immediate = options?.immediate ?? false;

	useEffect(() => {
		if (!active) return;
		return begin({ immediate });
	}, [active, begin, immediate]);
}

export function GlobalRouteLoading() {
	const { begin } = useGlobalLoading();
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		const stop = begin({ immediate: true });
		setHydrated(true);
		return stop;
	}, [begin]);

	return hydrated ? null : <LoaderVisual phase="active" serverFallback />;
}
