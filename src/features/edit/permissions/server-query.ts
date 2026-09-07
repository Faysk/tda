import "server-only";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "../access/repository";
import { queryPermissions, type PermissionsRequest } from "./query";
import { readPermissionsDirectory } from "./repository";
import type { PermissionsResult } from "./model";

export async function getPermissionsForEdit(
	request: PermissionsRequest,
): Promise<PermissionsResult> {
	try {
		const identity = await getVerifiedServerIdentity();
		if (!identity.ok) return identity;
		return await queryPermissions(identity.authUserId, request, {
			resolveAccessContext: loadEditAccessContext,
			readDirectory: readPermissionsDirectory,
		});
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
