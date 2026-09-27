import type { JobEvent, LocalJob, SystemSnapshot } from "./protocol";

export const ACTIVITY_BARK_LIBRARY_VERSION = "tda_activity_barks_v1" as const;
export const CORE_ACTIVITY_PACK_ID = "tda-core" as const;
export type ActivityHumorLevel = "off" | "light" | "tda";
export type BarkFamily = "speaker" | "devops" | "rpg" | "gpu" | "meta";

export type ActivityContext = Readonly<{
	eventCode: string;
	seq: number;
	eventAt: string;
	jobId: string;
	attempt: number | null;
	sessionId: string | null;
	profileId: string | null;
	speaker: string | null;
	track: number | null;
	totalTracks: number | null;
	window: number | null;
	segment: number | null;
	audioStartSeconds: number | null;
	audioEndSeconds: number | null;
	gpuName: string | null;
	gpuUtilizationPercent: number | null;
}>;

export type ActivityBarkRequirement = "speaker" | "window" | "segment" | "gpu" | "profile" | "attempt" | "track" | "total_tracks" | "gpu_utilization";

export type ActivityBarkConditions = Readonly<{
	speaker?: readonly string[];
	profile?: readonly string[];
	windowMin?: number;
	windowMax?: number;
	gpuUtilizationMin?: number;
	attemptMin?: number;
}>;

export type ActivityBark = Readonly<{
	packId?: string;
	id: string;
	family: BarkFamily;
	tone: Exclude<ActivityHumorLevel, "off">;
	eventCodes: readonly string[];
	requires?: readonly ActivityBarkRequirement[];
	conditions?: ActivityBarkConditions;
	text: string;
}>;

const SUCCESS_BARK_EVENTS = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);

export const CORE_ACTIVITY_BARKS: readonly ActivityBark[] = [
	{ id: "speaker-001", family: "speaker", tone: "light", eventCodes: ["QWEN_WINDOW_TRANSCRIBED"], requires: ["speaker"], text: "{speaker} avançou mais uma janela." },
	{ id: "speaker-002", family: "speaker", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED"], requires: ["speaker"], text: "{speaker} abriu a boca. O Qwen resolveu lidar com isso." },
	{ id: "speaker-003", family: "speaker", tone: "tda", eventCodes: ["WHISPER_SEGMENT_TRANSCRIBED"], requires: ["speaker"], text: "{speaker} entregou outro segmento. O Whisper segue empregado." },
	{ id: "devops-001", family: "devops", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED", "WHISPER_SEGMENT_TRANSCRIBED"], text: "Mais uma unidade sem rollback. DevOps chama isso de vitória." },
	{ id: "devops-002", family: "devops", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED"], text: "Pipeline verbal verde. Ninguém acordou o SRE." },
	{ id: "rpg-001", family: "rpg", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED"], text: "A GPU rolou Percepção. Sucesso." },
	{ id: "rpg-002", family: "rpg", tone: "light", eventCodes: ["WHISPER_SEGMENT_TRANSCRIBED"], text: "Mais um fragmento identificado no plano material." },
	{ id: "gpu-001", family: "gpu", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED", "WHISPER_SEGMENT_TRANSCRIBED"], requires: ["gpu"], text: "{gpu} mastigou mais uma unidade e pediu sobremesa." },
	{ id: "meta-001", family: "meta", tone: "tda", eventCodes: ["QWEN_WINDOW_TRANSCRIBED", "WHISPER_SEGMENT_TRANSCRIBED"], text: "O contador subiu de novo. Isso parece trabalho de verdade agora." },
	{ id: "meta-002", family: "meta", tone: "light", eventCodes: ["QWEN_WINDOW_TRANSCRIBED", "WHISPER_SEGMENT_TRANSCRIBED"], text: "Outra unidade concluída. Seguimos." },
] as const;

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function activityContext(
	event: JobEvent,
	job: LocalJob,
	system: SystemSnapshot | null,
): ActivityContext {
	const gpu = system?.gpus[0] ?? null;
	return {
		eventCode: event.code,
		seq: event.seq,
		eventAt: event.at,
		jobId: job.id,
		attempt: event.attempt,
		sessionId: job.context?.sessionId ?? null,
		profileId: job.context?.profileId ?? null,
		speaker: asString(event.data.speaker),
		track: asNumber(event.data.track),
		totalTracks: asNumber(event.data.total_tracks),
		window: asNumber(event.data.window),
		segment: asNumber(event.data.segment),
		audioStartSeconds: asNumber(event.data.start_seconds),
		audioEndSeconds: asNumber(event.data.end_seconds),
		gpuName: gpu?.name ?? null,
		gpuUtilizationPercent: gpu?.utilizationPercent ?? null,
	};
}

function hashSeed(value: string): number {
	let hash = 2166136261;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function eligible(template: ActivityBark, context: ActivityContext, level: ActivityHumorLevel) {
	if (level === "off" || !SUCCESS_BARK_EVENTS.has(context.eventCode)) return false;
	if (!template.eventCodes.includes(context.eventCode)) return false;
	if (level === "light" && template.tone !== "light") return false;
	for (const requirement of template.requires ?? []) {
		if (requirement === "speaker" && !context.speaker) return false;
		if (requirement === "window" && context.window === null) return false;
		if (requirement === "segment" && context.segment === null) return false;
		if (requirement === "gpu" && !context.gpuName) return false;
		if (requirement === "profile" && !context.profileId) return false;
		if (requirement === "attempt" && context.attempt === null) return false;
		if (requirement === "track" && context.track === null) return false;
		if (requirement === "total_tracks" && context.totalTracks === null) return false;
		if (requirement === "gpu_utilization" && context.gpuUtilizationPercent === null) return false;
	}
	const conditions = template.conditions;
	if (conditions?.speaker && (!context.speaker || !conditions.speaker.includes(context.speaker.toLocaleLowerCase("pt-BR")))) return false;
	if (conditions?.profile && (!context.profileId || !conditions.profile.includes(context.profileId))) return false;
	if (conditions?.windowMin !== undefined && (context.window === null || context.window < conditions.windowMin)) return false;
	if (conditions?.windowMax !== undefined && (context.window === null || context.window > conditions.windowMax)) return false;
	if (conditions?.gpuUtilizationMin !== undefined && (context.gpuUtilizationPercent === null || context.gpuUtilizationPercent < conditions.gpuUtilizationMin)) return false;
	if (conditions?.attemptMin !== undefined && (context.attempt === null || context.attempt < conditions.attemptMin)) return false;
	return true;
}

function render(template: string, context: ActivityContext): string {
	return template.replace(
		/\{(speaker|window|segment|gpu|profile|attempt|track|total_tracks|gpu_utilization)\}/gu,
		(match, placeholder: string) => {
			switch (placeholder) {
				case "speaker":
					return context.speaker ?? "";
				case "window":
					return context.window === null ? "" : String(context.window);
				case "segment":
					return context.segment === null ? "" : String(context.segment);
				case "gpu":
					return context.gpuName ?? "";
				case "profile":
					return context.profileId ?? "";
				case "attempt":
					return context.attempt === null ? "" : String(context.attempt);
				case "track":
					return context.track === null ? "" : String(context.track);
				case "total_tracks":
					return context.totalTracks === null ? "" : String(context.totalTracks);
				case "gpu_utilization":
					return context.gpuUtilizationPercent === null ? "" : String(Math.round(context.gpuUtilizationPercent));
				default:
					return match;
			}
		},
	);
}

export function selectActivityBark(
	context: ActivityContext,
	options: Readonly<{
		level?: ActivityHumorLevel;
		recentTemplateIds?: readonly string[];
		recentFamilies?: readonly BarkFamily[];
		catalog?: readonly ActivityBark[];
	}> = {},
): Readonly<{ packId: string; templateId: string; family: BarkFamily; text: string }> | null {
	const level = options.level ?? "tda";
	const catalog = options.catalog ?? CORE_ACTIVITY_BARKS;
	const recentIds = new Set(options.recentTemplateIds ?? []);
	const recentFamily = options.recentFamilies?.at(-1) ?? null;
	let candidates = catalog
		.filter((item) => eligible(item, context, level))
		.slice()
		.sort((left, right) => `${left.packId ?? CORE_ACTIVITY_PACK_ID}:${left.id}`.localeCompare(`${right.packId ?? CORE_ACTIVITY_PACK_ID}:${right.id}`));
	if (!candidates.length) return null;
	const withoutRecent = candidates.filter((item) => {
		const packId = item.packId ?? CORE_ACTIVITY_PACK_ID;
		return !recentIds.has(item.id) && !recentIds.has(`${packId}:${item.id}`);
	});
	if (withoutRecent.length) candidates = withoutRecent;
	const withoutFamily = candidates.filter((item) => item.family !== recentFamily);
	if (withoutFamily.length) candidates = withoutFamily;
	const seed = hashSeed(
		[context.jobId, context.attempt, context.seq, context.speaker ?? "", context.eventCode].join(":"),
	);
	const selected = candidates[seed % candidates.length];
	if (!selected) return null;
	return {
		packId: selected.packId ?? CORE_ACTIVITY_PACK_ID,
		templateId: selected.id,
		family: selected.family,
		text: render(selected.text, context),
	};
}

export function activityEventCanBeHumorous(event: Pick<JobEvent, "code" | "level">): boolean {
	return event.level === "info" && SUCCESS_BARK_EVENTS.has(event.code);
}
