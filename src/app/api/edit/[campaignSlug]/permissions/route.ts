import { getPermissionsForEdit } from "@/features/edit/permissions/server-query";
import type { PermissionsFailure } from "@/features/edit/permissions/model";

const statuses: Record<PermissionsFailure, number> = {
	unauthenticated: 401,
	profile_unresolved: 403,
	forbidden: 403,
	validation: 400,
	dependency_unavailable: 503,
	not_found: 404,
};
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ campaignSlug: string }> },
) {
	const { campaignSlug } = await params;
	const result = await getPermissionsForEdit({ campaignSlug });
	return Response.json(result, {
		status: result.ok ? 200 : statuses[result.reason],
		headers: { "Cache-Control": "private, no-store" },
	});
}
