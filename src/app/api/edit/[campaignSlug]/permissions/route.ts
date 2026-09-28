import { getPermissionsForEdit } from "@/features/edit/permissions/server-query";
import { mutatePermissionsForEdit } from "@/features/edit/permissions/server-mutation";
import type { PermissionsFailure } from "@/features/edit/permissions/model";

const statuses: Record<PermissionsFailure, number> = {
	unauthenticated: 401,
	profile_unresolved: 403,
	forbidden: 403,
	validation: 400,
	dependency_unavailable: 503,
	not_found: 404,
};

const mutationStatuses: Record<string, number> = {
	unauthenticated: 401,
	profile_unresolved: 403,
	forbidden: 403,
	validation: 400,
	not_found: 404,
	target_not_found: 404,
	target_not_in_campaign: 403,
	role_not_found: 404,
	delegation_forbidden: 403,
	confirmation_required: 409,
	duplicate: 409,
	assignment_not_active: 409,
	last_admin: 409,
	conflict: 409,
	dependency_unavailable: 503,
	reconciliation_required: 503,
};

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ campaignSlug: string }> },
) {
	const { campaignSlug } = await params;
	const result = await getPermissionsForEdit({ campaignSlug });
	return Response.json(result, {
		status: result.ok ? 200 : statuses[result.reason],
		headers: noStore,
	});
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ campaignSlug: string }> },
) {
	const { campaignSlug } = await params;
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ ok: false, reason: "validation" },
			{ status: 400, headers: noStore },
		);
	}
	if (!body || typeof body !== "object" || Array.isArray(body))
		return Response.json(
			{ ok: false, reason: "validation" },
			{ status: 400, headers: noStore },
		);

	const value = body as Record<string, unknown>;
	const result = await mutatePermissionsForEdit({
		campaignSlug,
		targetProfileId: value.targetProfileId,
		expectedRevision: value.expectedRevision,
		changes: value.changes,
		operationId: value.operationId,
		reason: value.reason,
		confirmSensitive: value.confirmSensitive,
		confirmSelfRevoke: value.confirmSelfRevoke,
	});

	return Response.json(result, {
		status: result.ok ? 200 : (mutationStatuses[result.reason] ?? 503),
		headers: noStore,
	});
}
