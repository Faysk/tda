import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import { collectStatistics, type SessionRow, type SegmentRow } from "./read";

export async function readStatistics(campaign: string) {
	const client = editDataClient();
	if (!client) throw new Error("Statistics connection unavailable");
	return collectStatistics(campaign, {
		async sessions(slug, after) {
			let query = client.from("sessions")
				.select("id,title,session_date,duration_ms,campaigns!inner(slug)")
				.eq("campaigns.slug", slug).order("id").limit(200);
			if (after) query = query.gt("id", after);
			const { data, error } = await query;
			if (error) throw new Error("Statistics sessions unavailable");
			return (data ?? []) as unknown as SessionRow[];
		},
		async segments(slug, session, after) {
			let query = client.from("transcript_segments")
				.select("id,session_id,source_segment_id,text,sessions!inner(campaigns!inner(slug))")
				.eq("sessions.campaigns.slug", slug).eq("session_id", session)
				.order("id").limit(200);
			if (after) query = query.gt("id", after);
			const { data, error } = await query;
			if (error) throw new Error("Statistics transcript unavailable");
			return (data ?? []) as unknown as SegmentRow[];
		},
	});
}
