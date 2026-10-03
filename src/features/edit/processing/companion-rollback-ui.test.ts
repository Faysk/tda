import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

// Execute the shipped renderer with a synthetic Desktop bridge. No runtime,
// account, download or local service is touched by this interaction test.
it("keeps rollback usable across polling and requires explicit confirmation", async () => {
	const elements = new Map<string, ReturnType<typeof element>>();
	function element() {
		const classes = new Set<string>();
		return {
			textContent: "",
			value: "",
			checked: false,
			disabled: false,
			classList: {
				add: (name: string) => classes.add(name),
				remove: (name: string) => classes.delete(name),
				toggle: (name: string, force: boolean) =>
					force ? classes.add(name) : classes.delete(name),
				contains: (name: string) => classes.has(name),
			},
			events: {} as Record<string, () => Promise<void>>,
			addEventListener(name: string, callback: () => Promise<void>) {
				this.events[name] = callback;
			},
			querySelector: (name: string) => get(name),
			append: () => {},
			replaceChildren: () => {},
		};
	}
	function get(id: string) {
		const existing = elements.get(id);
		if (existing) return existing;
		const created = element();
		elements.set(id, created);
		return created;
	}
	let version = "1.1.8";
	let status = "ready";
	let poll: () => Promise<void> = async () => {};
	const events: Record<string, () => Promise<void>> = {};
	const rollback = vi.fn(async (target: string) => {
		const previous_version = version;
		version = target;
		return { previous_version, version };
	});
	const prompt = vi.fn(() => "1.1.5");
	const confirm = vi.fn(() => false);
	const window = {
		pywebview: {
			api: {
				snapshot: async () => ({
					whisper_runtime: { version, status },
					settings: {},
				}),
				logs: async () => ({ logs: [] }),
				check_whisper_runtime: async () => ({
					status,
					current_version: version,
					version: "1.1.9",
					available: true,
				}),
				rollback_whisper_runtime: rollback,
			},
		},
		addEventListener: (name: string, callback: () => Promise<void>) => {
			events[name] = callback;
		},
		setInterval: (callback: () => Promise<void>) => {
			poll = callback;
			return 1;
		},
		setTimeout: () => 1,
		clearTimeout: () => {},
		clearInterval: () => {},
		prompt,
		confirm,
	};
	runInNewContext(
		readFileSync("local-companion/tda_companion/ui/app.js", "utf8"),
		{
			window,
			document: {
				getElementById: get,
				querySelectorAll: () => [],
				createElement: element,
				visibilityState: "visible",
			},
			setTimeout: () => 1,
			clearTimeout: () => {},
		},
	);
	await events.pywebviewready();
	expect(get("rollback-whisper-runtime").classList.contains("hidden")).toBe(
		false,
	);
	await get("check-whisper-runtime").events.click();
	await poll();
	expect(get("install-whisper-runtime").classList.contains("hidden")).toBe(
		false,
	);
	expect(get("rollback-whisper-runtime").classList.contains("hidden")).toBe(
		false,
	);
	await get("rollback-whisper-runtime").events.click();
	expect(rollback).not.toHaveBeenCalled();
	confirm.mockReturnValue(true);
	await get("rollback-whisper-runtime").events.click();
	expect(rollback).toHaveBeenCalledExactlyOnceWith("1.1.5");
	await poll();
	expect(get("whisper-runtime-detail").textContent).toContain("1.1.5");
	status = "corrupt";
	await poll();
	expect(get("rollback-whisper-runtime").classList.contains("hidden")).toBe(
		true,
	);
	expect(get("install-whisper-runtime").classList.contains("hidden")).toBe(
		true,
	);
});
