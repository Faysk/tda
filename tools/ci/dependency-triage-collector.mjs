import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { batchTriage, markdownDigest } from "./dependency-triage.mjs";

const REPO = "Faysk/tda";
const exactSha = (value) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const safe = (value) =>
	Array.from(String(value ?? "unknown"), (character) =>
		character.charCodeAt(0) < 32 ||
		character.charCodeAt(0) === 127 ||
		"|`<>".includes(character)
			? " "
			: character,
	)
		.join("")
		.slice(0, 180);
const fingerprint = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function triageConfiguration({
	timeZone = "Europe/Lisbon",
	digestTime = "08:00",
} = {}) {
	new Intl.DateTimeFormat("en", { timeZone }).format(0);
	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(digestTime))
		throw new Error("TRIAGE_DIGEST_TIME_INVALID");
	return {
		time_zone: timeZone,
		digest_time: digestTime,
		sla_status: "proposed-not-owner-approved",
		critical_triage: "same-local-day",
		high_triage: "next-business-day",
		channel: "github-step-summary",
		permits_merge: false,
		permits_release: false,
	};
}

// Strict data parser, never imports/executes a manifest from a PR. Unsupported
// TOML syntax remains unknown instead of claiming a reproducible lock.
export function directLockMismatches(manifest, lock) {
	const sections = new Map();
	let section = "";
	for (const line of manifest.split(/\r?\n/)) {
		const header = line.match(/^\[([^\]]+)\]\s*$/);
		if (header) {
			section = header[1];
			sections.set(section, "");
		} else sections.set(section, (sections.get(section) || "") + line + "\n");
	}
	const pins = new Map();
	for (const [name, keys] of [
		["project", ["dependencies"]],
		["project.optional-dependencies", ["test", "desktop", "packaging"]],
		["build-system", ["requires"]],
	]) {
		for (const key of keys) {
			const match = (sections.get(name) || "").match(
				new RegExp("^\\s*" + key + "\\s*=\\s*\\[([\\s\\S]*?)\\]", "m"),
			);
			if (!match) continue;
			const quoted = /"([^"\\]*)"/g;
			if (match[1].replace(quoted, "").replace(/[,\s]/g, "")) return null;
			for (const entry of match[1].matchAll(quoted)) {
				const pin = entry[1].match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9.+_-]+)$/);
				if (!pin) return null;
				const packageName = pin[1].toLowerCase().replace(/[_.-]+/g, "-");
				if (pins.has(packageName) && pins.get(packageName) !== pin[2])
					return null;
				pins.set(packageName, pin[2]);
			}
		}
	}
	if (!pins.size) return null;
	const constraints = new Map();
	for (const raw of lock.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = line.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9.+_-]+)$/);
		if (!match) return null;
		const name = match[1].toLowerCase().replace(/[_.-]+/g, "-");
		if (constraints.has(name)) return null;
		constraints.set(name, match[2]);
	}
	return [...pins]
		.filter(([name, version]) => constraints.get(name) !== version)
		.map(([name, version]) => ({
			package: name,
			manifest_pin: version,
			lock_pin: constraints.get(name) || "missing",
		}));
}

function selectPrRun(page, workflow, sha, number) {
	if (
		!Number.isSafeInteger(page?.total_count) ||
		!Array.isArray(page.workflow_runs) ||
		page.total_count !== page.workflow_runs.length
	)
		return null;
	return (
		page.workflow_runs
			.filter(
				(run) =>
					Number.isSafeInteger(run?.id) &&
					run.id > 0 &&
					run.name === workflow &&
					run.path ===
						`.github/workflows/${workflow === "CI" ? "ci" : "codeql"}.yml` &&
					run.event === "pull_request" &&
					run.head_sha === sha &&
					run.head_repository?.full_name === REPO &&
					Array.isArray(run.pull_requests) &&
					run.pull_requests.some((pr) => pr?.number === number),
			)
			.sort((a, b) => b.id - a.id)[0] || null
	);
}

export function collectDependencyTriage(
	api,
	{ prNumber, configuration = triageConfiguration() } = {},
) {
	if (
		prNumber !== undefined &&
		(!Number.isSafeInteger(prNumber) || prNumber < 1)
	)
		throw new Error("TRIAGE_PR_NUMBER_INVALID");
	const health = [];
	function read(path, category) {
		try {
			return api(path);
		} catch {
			health.push(category + ":unavailable");
			return null;
		}
	}
	const before = read(`repos/${REPO}/branches/main`, "main-before")?.commit
		?.sha;
	const alertPage = read(
		`repos/${REPO}/dependabot/alerts?state=open&per_page=100`,
		"advisories",
	);
	const alertsComplete = Array.isArray(alertPage) && alertPage.length < 100;
	if (!alertsComplete) health.push("advisories:unknown-or-truncated");
	// Native alerts refer to the repository dependency graph. They are never
	// relabelled as verified clearance or affectedness of a different PR head.
	const nativeAlerts = (Array.isArray(alertPage) ? alertPage : [])
		.filter(
			(alert) =>
				Number.isSafeInteger(alert?.number) &&
				alert.number > 0 &&
				alert.state === "open",
		)
		.map((alert) => {
			const severity = alert.security_advisory?.severity;
			const row = {
				number: alert.number,
				package: safe(alert.dependency?.package?.name),
				ecosystem: safe(alert.dependency?.package?.ecosystem),
				advisory: safe(alert.security_advisory?.ghsa_id),
				severity: ["critical", "high", "medium", "low"].includes(severity)
					? severity
					: "unknown",
				classification: ["critical", "high"].includes(severity)
					? "security-critical"
					: "needs-human",
				head_binding: "native-dependency-graph-not-pr-head-verified",
				action: "review-native-alert",
			};
			return {
				...row,
				fingerprint: fingerprint([
					REPO,
					row.number,
					row.advisory,
					row.severity,
					row.package,
				]),
			};
		})
		.sort(
			(a, b) =>
				["critical", "high", "medium", "low", "unknown"].indexOf(a.severity) -
					["critical", "high", "medium", "low", "unknown"].indexOf(
						b.severity,
					) || a.number - b.number,
		);
	const listing =
		prNumber === undefined
			? read(`repos/${REPO}/pulls?state=open&per_page=100`, "pulls")
			: [read(`repos/${REPO}/pulls/${prNumber}`, "pull")];
	if (!Array.isArray(listing) || listing.length >= 100)
		health.push("pulls:unknown-or-truncated");
	const snapshots = [];
	for (const listed of Array.isArray(listing) ? listing : []) {
		if (
			listed?.user?.login !== "dependabot[bot]" ||
			!Number.isSafeInteger(listed.number) ||
			listed.number < 1
		)
			continue;
		const pr = read(`repos/${REPO}/pulls/${listed.number}`, "current-pr");
		if (!pr || pr.number !== listed.number) {
			health.push("pr:" + listed.number + ":unavailable-or-mismatched");
			continue;
		}
		const sha = pr.head?.sha;
		const row = {
			pr: {
				repo: REPO,
				head_repo: pr.head?.repo?.full_name,
				author: pr.user?.login,
				number: pr.number,
				state: pr.state,
				head_sha: sha,
			},
			advisory: { status: "unknown", head_sha: sha },
			lock: { status: "unknown", head_sha: sha },
			ci: { head_sha: sha, complete: false },
			codeql: { head_sha: sha, conclusion: "unknown" },
		};
		if (exactSha(sha) && row.pr.head_repo === REPO && row.pr.state === "open") {
			for (const workflow of ["CI", "CodeQL"]) {
				const filename = workflow === "CI" ? "ci" : "codeql";
				const page = read(
					`repos/${REPO}/actions/workflows/${filename}.yml/runs?head_sha=${sha}&event=pull_request&per_page=100`,
					filename,
				);
				const run = selectPrRun(page, workflow, sha, pr.number);
				if (!run) continue;
				const currentBase =
					exactSha(before) &&
					run.pull_requests.some(
						(value) =>
							value?.number === pr.number && value.base?.sha === before,
					);
				const key = workflow === "CI" ? "ci" : "codeql";
				row[key] = {
					head_sha: sha,
					conclusion: run.conclusion || "pending",
					complete: false,
					run_id: run.id,
					base_status: currentBase ? "current-main" : "stale-or-unknown",
				};
				if (workflow === "CI" && run.status === "completed") {
					const page = read(
						`repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`,
						"ci-jobs",
					);
					row.ci.complete =
						currentBase &&
						Number.isSafeInteger(page?.total_count) &&
						Array.isArray(page.jobs) &&
						page.total_count === page.jobs.length;
					row.ci.failed_jobs = (Array.isArray(page?.jobs) ? page.jobs : [])
						.filter((job) =>
							["failure", "cancelled", "timed_out"].includes(job?.conclusion),
						)
						.map((job) => job.name);
				}
			}
			function contents(path) {
				const value = read(
					`repos/${REPO}/contents/${path}?ref=${sha}`,
					"direct-lock",
				);
				if (
					value?.type !== "file" ||
					value.encoding !== "base64" ||
					typeof value.content !== "string" ||
					!Number.isSafeInteger(value.size) ||
					value.size < 0 ||
					value.size > 1024 * 1024
				)
					return null;
				const bytes = Buffer.from(value.content, "base64");
				return bytes.length === value.size ? bytes.toString("utf8") : null;
			}
			const manifest = contents("local-companion/pyproject.toml");
			const lock = contents("local-companion/requirements-test.lock");
			const mismatch =
				manifest !== null && lock !== null
					? directLockMismatches(manifest, lock)
					: null;
			if (mismatch?.length)
				row.lock = {
					status: "direct-lock-mismatch",
					head_sha: sha,
					details: mismatch,
				};
			// Matching direct Python pins alone do not prove npm/transitive resolution.
			const afterPr = read(`repos/${REPO}/pulls/${pr.number}`, "head-refresh");
			if (!afterPr || afterPr.state !== "open" || afterPr.head?.sha !== sha)
				row.pr.state = "stale";
		}
		snapshots.push(row);
	}
	const after = read(`repos/${REPO}/branches/main`, "main-after")?.commit?.sha;
	if (!exactSha(before) || before !== after) {
		health.push("main:changed-or-unknown");
		for (const row of snapshots) {
			row.ci.complete = false;
			row.pr.state = "stale";
		}
	}
	return {
		schema_version: 1,
		repository: REPO,
		configuration,
		main_before_sha: exactSha(before) ? before : null,
		main_after_sha: exactSha(after) ? after : null,
		advisory_scope: "native-repository-alerts-not-pr-clearance",
		advisory_api_complete: alertsComplete,
		health: [...new Set(health)].sort(),
		native_alerts: nativeAlerts,
		snapshots,
		records: batchTriage(snapshots),
		permits_merge: false,
		permits_release: false,
	};
}

export function renderCollectedTriage(report) {
	const lines = [
		"## Dependency triage — authenticated read-only snapshot",
		"No PR, issue, label, merge, deployment or release was changed.",
		`Digest configuration: ${safe(report.configuration.digest_time)} ${safe(report.configuration.time_zone)}; SLA: ${safe(report.configuration.sla_status)}.`,
		"Native repository alerts are not verified clearance/affectedness of a PR head.",
		"",
		"| Native alert | Severity | Package | Priority | Fingerprint |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const row of report.native_alerts)
		lines.push(
			"| " +
				[
					row.number,
					row.severity,
					row.package,
					row.classification,
					row.fingerprint.slice(0, 16),
				]
					.map(safe)
					.join(" | ") +
				" |",
		);
	lines.push(
		"",
		"Advisory API complete: " +
			report.advisory_api_complete +
			"; zero rows is not universal security clearance.",
		"API health: " +
			(report.health.map(safe).join(", ") || "observed endpoints responded"),
		"",
		markdownDigest(report.records).replace(
			"offline advisory report",
			"deterministic classification of collected metadata",
		),
	);
	for (const row of report.snapshots)
		if (row.lock.status === "direct-lock-mismatch") {
			lines.push(
				"PR #" +
					row.pr.number +
					": direct pins disagree; run `python tools/refresh-companion-test-lock.py --check`, reconcile the lock, then repeat constrained Windows/Linux installs.",
			);
		}
	return lines.join("\n") + "\n";
}

function githubApi(path) {
	const result = execFileSync("gh", ["api", "--method", "GET", path], {
		encoding: "utf8",
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return JSON.parse(result);
}

function main() {
	if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== REPO)
		throw new Error("TRIAGE_REPOSITORY_INVALID");
	let prNumber;
	if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
		const event = JSON.parse(
			readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
		);
		const run = event.workflow_run;
		if (
			run?.name !== "CI" ||
			run.event !== "pull_request" ||
			run.head_repository?.full_name !== REPO ||
			!Array.isArray(run.pull_requests) ||
			run.pull_requests.length !== 1
		) {
			process.stdout.write(
				"Source CI does not identify one same-repository PR; no readiness inferred.\n",
			);
			return;
		}
		prNumber = run.pull_requests[0].number;
	}
	const configuration = triageConfiguration({
		timeZone: process.env.TDA_TRIAGE_TIME_ZONE || "Europe/Lisbon",
		digestTime: process.env.TDA_TRIAGE_DIGEST_TIME || "08:00",
	});
	const report = collectDependencyTriage(githubApi, {
		prNumber,
		configuration,
	});
	if (
		process.env.GITHUB_EVENT_NAME === "workflow_run" &&
		!report.records.length &&
		!report.native_alerts.length &&
		!report.health.length
	) {
		process.stdout.write(
			"No actionable dependency changes for this CI event.\n",
		);
		return;
	}
	const output = renderCollectedTriage(report);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
	process.stdout.write(output);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
