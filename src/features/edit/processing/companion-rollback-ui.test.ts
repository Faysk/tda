import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const rendererSource = () =>
	readFileSync("local-companion/tda_companion/ui/app.js", "utf8");

function createHarness() {
	const elements = new Map<string, any>();
	const windowEvents: Record<string, (event?: any) => unknown> = {};
	let activeElement: any = null;
	let poll: () => Promise<void> = async () => {};
	let elementSequence = 0;
	let whisperVersion = "1.1.8";
	let qwenVersion = "1.0.7";

	function element(id = `generated-${elementSequence++}`) {
		const classes = new Set<string>();
		const listeners: Record<string, (event?: any) => unknown> = {};
		const attributes = new Map<string, string>();
		const children: any[] = [];
		const node: any = {
			id,
			textContent: "",
			value: "",
			checked: false,
			disabled: false,
			hidden: false,
			open: false,
			isConnected: true,
			className: "",
			type: "",
			dataset: {},
			children,
			classList: {
				add: (...names: string[]) => names.forEach((name) => classes.add(name)),
				remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
				toggle: (name: string, force?: boolean) => {
					const enabled = force === undefined ? !classes.has(name) : force;
					if (enabled) classes.add(name);
					else classes.delete(name);
					return enabled;
				},
				contains: (name: string) => classes.has(name),
			},
			addEventListener(name: string, callback: (event?: any) => unknown) {
				listeners[name] = callback;
			},
			async dispatch(name: string, extra: Record<string, unknown> = {}) {
				const callback = listeners[name];
				if (!callback) return undefined;
				return await callback({
					preventDefault: () => undefined,
					target: node,
					currentTarget: node,
					key: undefined,
					shiftKey: false,
					...extra,
				});
			},
			querySelector: (selector: string) => get(`${id}:${selector}`),
			querySelectorAll: () => [],
			append: (...nodes: any[]) => children.push(...nodes),
			replaceChildren: (...nodes: any[]) => {
				children.splice(0, children.length, ...nodes);
			},
			setAttribute(name: string, value: string) {
				attributes.set(name, value);
				if (name === "open") node.open = true;
			},
			removeAttribute(name: string) {
				attributes.delete(name);
				if (name === "open") node.open = false;
			},
			getAttribute: (name: string) => attributes.get(name) ?? null,
			focus() {
				activeElement = node;
			},
			showModal() {
				node.open = true;
			},
			close() {
				node.open = false;
			},
			closest(selector: string) {
				if (selector !== ".hidden") return null;
				if (id === "maintenance-dialog-version") {
					const field = get("maintenance-dialog-version-field");
					return field.classList.contains("hidden") ? field : null;
				}
				if (id === "maintenance-dialog-danger") {
					const field = get("maintenance-dialog-danger-field");
					return field.classList.contains("hidden") ? field : null;
				}
				return null;
			},
		};
		return node;
	}

	function get(id: string) {
		const existing = elements.get(id);
		if (existing) return existing;
		const created = element(id);
		elements.set(id, created);
		return created;
	}

	const dialog = get("maintenance-dialog");
	dialog.querySelectorAll = () => [
		get("maintenance-dialog-cancel"),
		get("maintenance-dialog-version"),
		get("maintenance-dialog-danger"),
		get("maintenance-dialog-confirm"),
	];

	const rollbackWhisper = vi.fn(async (target: string) => {
		const previous_version = whisperVersion;
		whisperVersion = target;
		return { previous_version, version: target };
	});
	const installWhisper = vi.fn(async () => ({
		accepted: true,
		version: "1.1.9",
	}));
	const installQwen = vi.fn(async () => ({
		accepted: true,
		version: "1.0.8",
	}));
	const restartAgent = vi.fn(async () => true);
	const installUpdate = vi.fn(async () => ({
		accepted: true,
		version: "0.3.16",
	}));
	const uninstall = vi.fn(async (_purge: boolean) => ({ accepted: true }));
	const closeDesktop = vi.fn(async () => true);

	const api: any = {
		snapshot: vi.fn(async () => ({
			version: "0.3.15",
			agent: {
				lifecycle: "ready",
				api_version: "1",
				port: 8765,
				uptime_seconds: 60,
			},
			connection: { state: "ready", service_version: "0.3.15" },
			counts: { processing: 0, queued: 0, completed: 0, attention: 0 },
			jobs: [],
			settings: { check_updates: false },
			whisper_runtime: { version: whisperVersion, status: "ready" },
			qwen_runtime: { version: qwenVersion, status: "ready" },
		})),
		logs: vi.fn(async () => ({ logs: [] })),
		check_whisper_runtime: vi.fn(async () => ({
			status: "ready",
			current_version: whisperVersion,
			version: "1.1.9",
			available: true,
			size: 2048,
			rollback_versions: ["1.1.5", "1.1.4"],
		})),
		install_whisper_runtime: installWhisper,
		rollback_whisper_runtime: rollbackWhisper,
		check_qwen_runtime: vi.fn(async () => ({
			status: "ready",
			current_version: qwenVersion,
			version: "1.0.8",
			available: true,
			size: 4096,
		})),
		install_qwen_runtime: vi.fn(async () => {
			const result = await installQwen();
			qwenVersion = result.version;
			return result;
		}),
		check_update: vi.fn(async () => ({
			available: true,
			version: "0.3.16",
		})),
		install_update: installUpdate,
		uninstall,
		restart_agent: restartAgent,
		close_desktop: closeDesktop,
		open_tda: vi.fn(),
		open_local_folder: vi.fn(),
		open_logs_folder: vi.fn(),
		set_queue_paused: vi.fn(),
		diagnostics: vi.fn(async () => ({ overall: "pass", checks: [] })),
		export_diagnostics: vi.fn(async () => "diagnostic.json"),
		update_settings: vi.fn(),
	};

	const fakeWindow: any = {
		pywebview: { api },
		addEventListener: (name: string, callback: (event?: any) => unknown) => {
			windowEvents[name] = callback;
		},
		setInterval: (callback: () => Promise<void>) => {
			poll = callback;
			return 1;
		},
		setTimeout: () => 1,
		clearTimeout: () => undefined,
		clearInterval: () => undefined,
	};

	const fakeDocument: any = {
		getElementById: get,
		querySelectorAll: () => [],
		createElement: () => element(),
		visibilityState: "visible",
		get activeElement() {
			return activeElement;
		},
	};

	runInNewContext(rendererSource(), {
		window: fakeWindow,
		document: fakeDocument,
		setTimeout: () => 1,
		clearTimeout: () => undefined,
	});

	async function boot() {
		await windowEvents.pywebviewready?.();
	}

	return {
		api,
		get,
		boot,
		poll: async () => await poll(),
		click: async (id: string) => await get(id).dispatch("click"),
		submit: async () => await get("maintenance-dialog-form").dispatch("submit"),
		keydown: async (key: string, shiftKey = false) =>
			await dialog.dispatch("keydown", { key, shiftKey }),
		active: () => activeElement,
		spies: {
			rollbackWhisper,
			installWhisper,
			installQwen,
			restartAgent,
			installUpdate,
			uninstall,
			closeDesktop,
		},
	};
}

describe("Companion maintenance dialogs", () => {
	it("keeps Whisper rollback usable across polling and validates inline before mutation", async () => {
		const harness = createHarness();
		await harness.boot();

		expect(
			harness.get("rollback-whisper-runtime").classList.contains("hidden"),
		).toBe(false);
		await harness.click("check-whisper-runtime");
		await harness.poll();
		expect(
			harness.get("rollback-whisper-runtime").classList.contains("hidden"),
		).toBe(false);

		await harness.click("rollback-whisper-runtime");
		expect(harness.get("maintenance-dialog").open).toBe(true);
		expect(harness.active()).toBe(harness.get("maintenance-dialog-cancel"));
		expect(harness.spies.rollbackWhisper).not.toHaveBeenCalled();
		expect(harness.get("maintenance-dialog-version-options").children).toHaveLength(
			2,
		);

		await harness.keydown("Escape");
		expect(harness.get("maintenance-dialog").open).toBe(false);
		expect(harness.spies.rollbackWhisper).not.toHaveBeenCalled();
		expect(harness.active()).toBe(harness.get("rollback-whisper-runtime"));

		await harness.click("rollback-whisper-runtime");
		harness.get("maintenance-dialog-version").value = "banana";
		await harness.submit();
		expect(harness.spies.rollbackWhisper).not.toHaveBeenCalled();
		expect(harness.get("maintenance-dialog-error").textContent).toContain(
			"X.Y.Z",
		);
		expect(harness.get("maintenance-dialog").open).toBe(true);

		harness.get("maintenance-dialog-version").value = "1.1.8";
		await harness.get("maintenance-dialog-version").dispatch("input");
		await harness.submit();
		expect(harness.spies.rollbackWhisper).not.toHaveBeenCalled();
		expect(harness.get("maintenance-dialog-error").textContent).toContain(
			"anterior",
		);

		harness.get("maintenance-dialog-version").value = "1.1.5";
		await harness.get("maintenance-dialog-version").dispatch("input");
		await harness.submit();
		expect(harness.spies.rollbackWhisper).toHaveBeenCalledExactlyOnceWith(
			"1.1.5",
		);
		expect(harness.get("maintenance-dialog").open).toBe(false);
		await harness.poll();
		expect(harness.get("whisper-runtime-detail").textContent).toContain(
			"1.1.5",
		);
	});

	it("traps focus, returns it to the trigger, and keeps Escape side-effect free", async () => {
		const harness = createHarness();
		await harness.boot();
		await harness.click("check-whisper-runtime");
		await harness.click("rollback-whisper-runtime");

		expect(harness.active()).toBe(harness.get("maintenance-dialog-cancel"));
		await harness.keydown("Tab", true);
		expect(harness.active()).toBe(harness.get("maintenance-dialog-confirm"));
		await harness.keydown("Tab");
		expect(harness.active()).toBe(harness.get("maintenance-dialog-cancel"));

		await harness.keydown("Escape");
		expect(harness.get("maintenance-dialog").open).toBe(false);
		expect(harness.active()).toBe(harness.get("rollback-whisper-runtime"));
		expect(harness.spies.rollbackWhisper).not.toHaveBeenCalled();
	});

	it("migrates every maintenance mutation to one integrated confirmation", async () => {
		const harness = createHarness();
		await harness.boot();

		await harness.click("install-whisper-runtime");
		expect(harness.spies.installWhisper).not.toHaveBeenCalled();
		await harness.click("maintenance-dialog-cancel");
		expect(harness.spies.installWhisper).not.toHaveBeenCalled();
		await harness.click("install-whisper-runtime");
		await harness.submit();
		expect(harness.spies.installWhisper).toHaveBeenCalledTimes(1);

		await harness.click("check-qwen-runtime");
		await harness.click("install-qwen-runtime");
		expect(harness.spies.installQwen).not.toHaveBeenCalled();
		await harness.submit();
		expect(harness.spies.installQwen).toHaveBeenCalledTimes(1);

		await harness.click("restart-agent");
		expect(harness.spies.restartAgent).not.toHaveBeenCalled();
		await harness.submit();
		expect(harness.spies.restartAgent).toHaveBeenCalledTimes(1);

		await harness.click("check-update");
		await harness.click("install-update");
		expect(harness.spies.installUpdate).not.toHaveBeenCalled();
		await harness.submit();
		expect(harness.spies.installUpdate).toHaveBeenCalledTimes(1);
		expect(harness.spies.closeDesktop).toHaveBeenCalledTimes(1);

		await harness.click("uninstall-keep");
		expect(harness.spies.uninstall).not.toHaveBeenCalled();
		await harness.submit();
		expect(harness.spies.uninstall).toHaveBeenCalledWith(false);

		await harness.click("uninstall-purge");
		expect(harness.get("maintenance-dialog-confirm").disabled).toBe(true);
		await harness.submit();
		expect(harness.spies.uninstall).toHaveBeenCalledTimes(1);
		expect(harness.get("maintenance-dialog-error").textContent).toContain(
			"REMOVER",
		);
		harness.get("maintenance-dialog-danger").value = "REMOVER";
		await harness.get("maintenance-dialog-danger").dispatch("input");
		expect(harness.get("maintenance-dialog-confirm").disabled).toBe(false);
		await harness.submit();
		expect(harness.spies.uninstall).toHaveBeenNthCalledWith(2, true);
		expect(harness.spies.closeDesktop).toHaveBeenCalledTimes(3);
	});

	it("keeps dialog context after an error and blocks duplicate submit while pending", async () => {
		const harness = createHarness();
		await harness.boot();

		harness.spies.restartAgent.mockRejectedValueOnce(
			new Error("AGENT_CONNECTION_TIMEOUT"),
		);
		await harness.click("restart-agent");
		await harness.submit();
		expect(harness.get("maintenance-dialog").open).toBe(true);
		expect(harness.get("maintenance-dialog-error").textContent).toContain(
			"demorou demais",
		);
		expect(harness.get("maintenance-dialog-confirm").disabled).toBe(false);

		let resolveRestart: ((value: boolean) => void) | null = null;
		harness.spies.restartAgent.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					resolveRestart = resolve;
				}),
		);
		const firstSubmit = harness.submit();
		await Promise.resolve();
		const duplicateSubmit = harness.submit();
		expect(harness.spies.restartAgent).toHaveBeenCalledTimes(2);
		resolveRestart?.(true);
		await Promise.all([firstSubmit, duplicateSubmit]);
		expect(harness.spies.restartAgent).toHaveBeenCalledTimes(2);
		expect(harness.get("maintenance-dialog").open).toBe(false);
	});

	it("ships modal semantics, narrow-screen scrolling, and no native browser prompts", () => {
		const html = readFileSync(
			"local-companion/tda_companion/ui/index.html",
			"utf8",
		);
		const css = readFileSync(
			"local-companion/tda_companion/ui/app.css",
			"utf8",
		);
		const source = rendererSource();

		expect(html).toContain('id="maintenance-dialog"');
		expect(html).toContain('aria-labelledby="maintenance-dialog-title"');
		expect(html).toContain('aria-describedby="maintenance-dialog-description"');
		expect(html).toContain('role="status"');
		expect(html).toContain('role="alert"');
		expect(css).toContain("max-height: min(86dvh, 720px)");
		expect(css).toContain(".maintenance-dialog-body");
		expect(css).toContain("overflow: auto");
		expect(css).toContain("@media (max-width: 620px)");
		expect(source).not.toMatch(/window\.(?:alert|confirm|prompt)\s*\(/);
	});
});
