import type { LocalJob } from "./protocol";

export type QueueFilter = "active" | "attention" | "completed" | "cancelled" | "all";
export type QueueSort = "updated" | "status" | "profile" | "session";

export const queueFilters: readonly { id: QueueFilter; label: string }[] = [
	{ id: "active", label: "Ativos" },
	{ id: "attention", label: "Atenção" },
	{ id: "completed", label: "Concluídos" },
	{ id: "cancelled", label: "Cancelados" },
	{ id: "all", label: "Todos" },
];

export const queueSortOptions: readonly { id: QueueSort; label: string }[] = [
	{ id: "updated", label: "Atualização" },
	{ id: "status", label: "Estado" },
	{ id: "profile", label: "Profile" },
	{ id: "session", label: "Sessão" },
];

const statusOrder: Record<LocalJob["status"], number> = {
	running: 0,
	queued: 1,
	failed: 2,
	interrupted: 3,
	succeeded: 4,
	cancelled: 5,
};

const knownProfiles: Record<string, string> = {
	"qwen-quality": "Qwen Quality",
	"whisper-turbo": "Whisper Turbo",
	"whisper-quality": "Whisper Quality",
	"whisper-fast": "Whisper Fast",
};

function normalized(value: string | null | undefined): string {
	return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function updatedMillis(job: LocalJob): number {
	const parsed = Date.parse(job.updated_at);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function queueProfileLabel(profileId: string | null | undefined): string {
	if (!profileId) return "Profile não informado";
	const known = knownProfiles[profileId];
	if (known) return known;
	return profileId
		.split(/[-_.]+/u)
		.filter(Boolean)
		.map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
		.join(" ");
}

export function compactQueueId(value: string, head = 12, tail = 6): string {
	if (value.length <= head + tail + 1) return value;
	return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function queuePrimaryIdentity(job: LocalJob): string {
	return (
		job.context?.sessionId ??
		job.context?.sourceId ??
		compactQueueId(job.id)
	);
}

export function queueSupportingIdentity(job: LocalJob): string | null {
	const session = job.context?.sessionId;
	const source = job.context?.sourceId;
	if (session && source) return compactQueueId(source);
	if (session || source) return compactQueueId(job.id);
	return null;
}

export function queueFilterCount(
	jobs: readonly LocalJob[],
	filter: QueueFilter,
): number {
	if (filter === "all") return jobs.length;
	return jobs.filter((job) => {
		if (filter === "active") return job.status === "running" || job.status === "queued";
		if (filter === "attention") return job.status === "failed" || job.status === "interrupted";
		if (filter === "completed") return job.status === "succeeded";
		return job.status === "cancelled";
	}).length;
}

function matchesFilter(job: LocalJob, filter: QueueFilter): boolean {
	if (filter === "all") return true;
	if (filter === "active") return job.status === "running" || job.status === "queued";
	if (filter === "attention") return job.status === "failed" || job.status === "interrupted";
	if (filter === "completed") return job.status === "succeeded";
	return job.status === "cancelled";
}

function matchesQuery(job: LocalJob, query: string): boolean {
	const needle = normalized(query);
	if (!needle) return true;
	const fields = [
		job.id,
		job.kind,
		job.status,
		job.stage,
		job.error?.code,
		job.context?.sessionId,
		job.context?.sourceId,
		job.context?.profileId,
		queueProfileLabel(job.context?.profileId),
	];
	return fields.some((value) => normalized(value).includes(needle));
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right, "pt-BR", {
		numeric: true,
		sensitivity: "base",
	});
}

function compareWithinPinnedGroup(
	left: LocalJob,
	right: LocalJob,
	sort: QueueSort,
): number {
	if (sort === "status") {
		const status = statusOrder[left.status] - statusOrder[right.status];
		if (status !== 0) return status;
	}
	if (sort === "profile") {
		const profile = compareText(
			queueProfileLabel(left.context?.profileId),
			queueProfileLabel(right.context?.profileId),
		);
		if (profile !== 0) return profile;
	}
	if (sort === "session") {
		const identity = compareText(queuePrimaryIdentity(left), queuePrimaryIdentity(right));
		if (identity !== 0) return identity;
	}
	return updatedMillis(right) - updatedMillis(left);
}

export function selectQueueJobs(
	jobs: readonly LocalJob[],
	filter: QueueFilter,
	query: string,
	sort: QueueSort,
): LocalJob[] {
	return jobs
		.filter((job) => matchesFilter(job, filter) && matchesQuery(job, query))
		.sort((left, right) => {
			const leftRunning = left.status === "running" ? 0 : 1;
			const rightRunning = right.status === "running" ? 0 : 1;
			if (leftRunning !== rightRunning) return leftRunning - rightRunning;
			return compareWithinPinnedGroup(left, right, sort);
		});
}
