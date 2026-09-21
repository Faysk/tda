import { getLembraIdentity } from "@/features/lembra/access";
import {
	isLembraMediaMime,
	isLembraUuid,
	type LembraMediaMime,
} from "@/features/lembra/model";
import {
	loadLembraReferenceRow,
	validLembraReferenceRow,
} from "@/features/lembra/repository";
import {
	lembraPersistenceEnabled,
	readVerifiedLembraObject,
} from "@/features/lembra/server";
import { lembraDataClient } from "@/integrations/supabase/server";

export const dynamic = "force-dynamic";

function accessStatus(reason: string) {
	return reason === "unauthenticated" ? 401 : 503;
}

export async function GET(
	_request: Request,
	context: { params: Promise<{ referenceId: string }> },
) {
	if (!lembraPersistenceEnabled()) {
		return new Response("Lembra media unavailable", { status: 503 });
	}

	const { referenceId } = await context.params;
	if (!isLembraUuid(referenceId)) {
		return new Response("Not found", { status: 404 });
	}

	const access = await getLembraIdentity();
	if (!access.ok) {
		return new Response("Access denied", {
			status: accessStatus(access.reason),
		});
	}

	const client = lembraDataClient();
	if (!client) {
		return new Response("Dependency unavailable", { status: 503 });
	}

	try {
		const row = await loadLembraReferenceRow(client, referenceId);
		if (
			!row ||
			!validLembraReferenceRow(row) ||
			!isLembraMediaMime(row.mime_type)
		) {
			return new Response("Not found", { status: 404 });
		}

		const bytes = await readVerifiedLembraObject({
			referenceId: row.id,
			bucket: row.staged_bucket,
			objectKey: row.object_key,
			sha256: row.sha256,
			mimeType: row.mime_type as LembraMediaMime,
			bytes: Number(row.byte_size),
			width: row.width,
			height: row.height,
		});

		return new Response(Buffer.from(bytes), {
			status: 200,
			headers: {
				"Content-Type": row.mime_type,
				"Content-Length": String(bytes.length),
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) {
		console.error(
			"Lembra image read failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return new Response("Reference unavailable", { status: 503 });
	}
}
