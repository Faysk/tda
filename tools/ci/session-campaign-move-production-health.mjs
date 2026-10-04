import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 15000;
const EXPECTED_SCHEMA = "tda.session-campaign-move-release-health.v1";

function unquote(value) {
	const text = value.trim();
	if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
		return text
			.slice(1, -1)
			.replace(/\\n/gu, "\n")
			.replace(/\\r/gu, "\r")
			.replace(/\\t/gu, "\t")
			.replace(/\\"/gu, '"')
			.replace(/\\\\/gu, "\\");
	}
	if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
		return text.slice(1, -1);
	}
	return text;
}

export function parseProductionEnv(text) {
	const values = {};
	for (const rawLine of String(text ?? "").split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) continue;
		const key = line.slice(0, separator).trim();
		if (key !== "SUPABASE_URL" && key !== "SUPABASE_SECRET_KEY") continue;
		values[key] = unquote(line.slice(separator + 1));
	}
	return values;
}

function normalizedHealth(payload) {
	const candidate = Array.isArray(payload) ? payload[0] : payload;
	return candidate && typeof candidate === "object" && !Array.isArray(candidate)
		? candidate
		: null;
}

function assertBoolean(value, expected, label) {
	if (value !== expected) {
		throw new Error(`campaign move release health mismatch: ${label}`);
	}
}

export async function verifySessionCampaignMoveProductionHealth({
	supabaseUrl,
	secretKey,
	projectRef,
	phase,
	fetchImpl = globalThis.fetch,
	logger = console.log,
}) {
	if (!["pre_promote", "canonical"].includes(phase)) {
		throw new Error("phase must be pre_promote or canonical");
	}
	if (!/^[a-z0-9]{20}$/u.test(projectRef ?? "")) {
		throw new Error("invalid Supabase project ref");
	}
	const base = new URL(supabaseUrl);
	if (
		base.protocol !== "https:" ||
		base.hostname !== `${projectRef}.supabase.co` ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	) {
		throw new Error("Supabase URL does not match the governed Production project");
	}
	if (typeof secretKey !== "string" || secretKey.length < 32) {
		throw new Error("Production Supabase secret key is unavailable");
	}

	const response = await fetchImpl(
		new URL("/rest/v1/rpc/session_campaign_move_release_health", base),
		{
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				apikey: secretKey,
				authorization: `Bearer ${secretKey}`,
			},
			body: "{}",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		},
	);
	if (!response?.ok) {
		throw new Error(
			`campaign move release health request failed with HTTP ${response?.status ?? "unknown"}`,
		);
	}

	const health = normalizedHealth(await response.json());
	if (!health || health.schema !== EXPECTED_SCHEMA) {
		throw new Error("campaign move release health returned an incompatible schema");
	}
	if (health.ok !== true) {
		throw new Error("campaign move release health is not ok");
	}
	if (!Number.isInteger(health.contractVersion) || health.contractVersion < 2) {
		throw new Error("campaign move contract is older than v2");
	}
	if (health.registryDriftCount !== 0) {
		throw new Error("campaign move registry drift is not empty");
	}

	const grants = health.grants;
	if (!grants || typeof grants !== "object" || Array.isArray(grants)) {
		throw new Error("campaign move release health is missing grant state");
	}
	assertBoolean(grants.legacyCommitServiceRole, false, "legacy service-role commit");
	assertBoolean(grants.legacyCommitAuthenticated, false, "legacy authenticated commit");
	assertBoolean(grants.legacyCommitAnon, false, "legacy anon commit");
	assertBoolean(grants.preflightServiceRole, true, "service-role preflight");
	assertBoolean(grants.preflightAuthenticated, false, "authenticated preflight");
	assertBoolean(grants.preflightAnon, false, "anon preflight");
	assertBoolean(grants.v2CommitServiceRole, true, "service-role v2 commit");
	assertBoolean(grants.v2CommitAuthenticated, false, "authenticated v2 commit");
	assertBoolean(grants.v2CommitAnon, false, "anon v2 commit");
	assertBoolean(grants.registryHelperServiceRole, false, "service-role registry helper");

	const receipt = {
		schema: "tda.session-campaign-move-production-health.v1",
		phase,
		ok: true,
		contractVersion: health.contractVersion,
		registryDriftCount: health.registryDriftCount,
		legacyCommitServiceRole: false,
		v2CommitServiceRole: true,
		browserCommitExecute: false,
	};
	logger(JSON.stringify(receipt));
	return receipt;
}

function argsMap(argv) {
	const result = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		result.set(argv[index], argv[index + 1]);
	}
	return result;
}

async function main() {
	const args = argsMap(process.argv.slice(2));
	const envFile = args.get("--env-file");
	const projectRef = args.get("--project-ref");
	const phase = args.get("--phase");
	if (!envFile || !projectRef || !phase) {
		throw new Error("--env-file, --project-ref and --phase are required");
	}
	const values = parseProductionEnv(await readFile(envFile, "utf8"));
	await verifySessionCampaignMoveProductionHealth({
		supabaseUrl: values.SUPABASE_URL,
		secretKey: values.SUPABASE_SECRET_KEY,
		projectRef,
		phase,
	});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : "campaign move release health failed");
		process.exitCode = 1;
	});
}
