import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import type { EditAccessContext, EditGrant } from "./policy";

export async function loadEditAccessContext(
	authUserId: string,
): Promise<EditAccessContext | null> {
	const client = editDataClient();
	if (!client) return null;

	const { data: profile, error: profileError } = await client
		.from("profiles")
		.select("id")
		.eq("auth_user_id", authUserId)
		.maybeSingle();

	if (profileError) throw new Error("Edit profile lookup unavailable");
	if (!profile) {
		return { authUserId, profileId: null, grants: [] };
	}

	const now = new Date().toISOString();
	const { data: assignments, error: assignmentError } = await client
		.from("role_assignments")
		.select("role_id,scope_type,scope_id,status,starts_at,ends_at")
		.eq("profile_id", profile.id)
		.eq("status", "active")
		.lte("starts_at", now)
		.or(`ends_at.is.null,ends_at.gt.${now}`);

	if (assignmentError) throw new Error("Edit role lookup unavailable");
	if (!assignments?.length) {
		return { authUserId, profileId: profile.id, grants: [] };
	}

	const roleIds = [...new Set(assignments.map((row) => row.role_id))];
	const { data: permissions, error: permissionError } = await client
		.from("role_permissions")
		.select("role_id,permission_action")
		.in("role_id", roleIds);

	if (permissionError) throw new Error("Edit permission lookup unavailable");

	const actionsByRole = new Map<string, string[]>();
	for (const permission of permissions ?? []) {
		const actions = actionsByRole.get(permission.role_id) ?? [];
		actions.push(permission.permission_action);
		actionsByRole.set(permission.role_id, actions);
	}

	const grants: EditGrant[] = assignments.flatMap((assignment) =>
		(actionsByRole.get(assignment.role_id) ?? []).map((action) => ({
			action,
			scopeType: assignment.scope_type,
			scopeId: assignment.scope_id,
			status: assignment.status,
			startsAt: assignment.starts_at,
			endsAt: assignment.ends_at,
		})),
	);

	return { authUserId, profileId: profile.id, grants };
}
