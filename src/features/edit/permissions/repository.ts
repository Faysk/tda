import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import { projectPermissionsDirectory } from "./projection";
import type { PermissionsDirectory } from "./model";

// A complete bounded snapshot, never a silently truncated permissions inventory.
const MAX_ROWS = 500;
function completeRows<T>(result: {
	data: T[] | null;
	error: unknown;
	count: number | null;
}): T[] {
	if (
		result.error ||
		!result.data ||
		result.count === null ||
		result.count !== result.data.length
	)
		throw new Error("Permissions snapshot unavailable or capacity exceeded");
	return result.data;
}

/** Internal repository: call only after the permissions capability boundary. */
export async function readPermissionsDirectory(
	campaignSlug: string,
): Promise<PermissionsDirectory | null> {
	const client = editDataClient();
	if (!client) throw new Error("Permissions data connection unavailable");
	const { data: campaign, error } = await client
		.from("campaigns")
		.select("slug,name")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (error) throw new Error("Permissions campaign lookup unavailable");
	if (!campaign) return null;

	const assignments = completeRows(
		await client
			.from("role_assignments")
			.select(
				"id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at",
				{ count: "exact" },
			)
			.or(
				`and(scope_type.eq.campaign,scope_id.eq.${campaignSlug}),and(scope_type.eq.project,scope_id.eq.tda)`,
			)
			.order("id")
			.limit(MAX_ROWS),
	);
	if (!assignments.length)
		return {
			campaign: { slug: campaign.slug, name: campaign.name },
			people: [],
			checkedAt: new Date().toISOString(),
		};
	const profileIds = [...new Set(assignments.map((row) => row.profile_id))];
	const roleIds = [...new Set(assignments.map((row) => row.role_id))];
	const [profileResult, roleResult, permissionResult] = await Promise.all([
		client
			.from("profiles")
			.select("id,display_name,auth_user_id,discord_id", { count: "exact" })
			.in("id", profileIds)
			.order("display_name")
			.order("id")
			.limit(MAX_ROWS),
		client
			.from("role_definitions")
			.select("id,name,slug", { count: "exact" })
			.in("id", roleIds)
			.limit(MAX_ROWS),
		client
			.from("role_permissions")
			.select("role_id,permission_action", { count: "exact" })
			.in("role_id", roleIds)
			.limit(MAX_ROWS),
	]);
	const profiles = completeRows(profileResult);
	const roles = completeRows(roleResult);
	const permissions = completeRows(permissionResult);
	if (profiles.length !== profileIds.length || roles.length !== roleIds.length)
		throw new Error("Permissions snapshot changed; retry required");
	return projectPermissionsDirectory({
		campaign,
		assignments,
		profiles,
		roles,
		permissions,
		now: new Date(),
	});
}
