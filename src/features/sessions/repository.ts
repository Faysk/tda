import "server-only";
import { publishedDataClient } from "@/integrations/supabase/server";
import {
	CAMPAIGN_SLUG,
	toPublishedSession,
	type PublishedSession,
} from "./model";
const columns =
	"source_session_id,title,session_date,arc,summary_short,status,campaigns!inner(slug)";
export async function listPublishedSessions(): Promise<
	PublishedSession[] | null
> {
	const client = publishedDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("sessions")
		.select(columns)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.limit(500);
	if (error) throw new Error("Published sessions unavailable");
	return (data ?? []).flatMap((row) => {
		const item = toPublishedSession(row);
		return item ? [item] : [];
	});
}
export async function findPublishedSession(id: string) {
	if (!id || id.length > 220) return null;
	const client = publishedDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("sessions")
		.select(
			"source_session_id,title,session_date,arc,summary_short,summary_full,status,campaigns!inner(slug)",
		)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.eq("source_session_id", id)
		.maybeSingle();
	if (error) throw new Error("Published session unavailable");
	return data ? toPublishedSession(data, true) : null;
}
