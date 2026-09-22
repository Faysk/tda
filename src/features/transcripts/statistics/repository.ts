import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import { collectStatistics, type SessionRow, type SegmentRow } from "./read";
import { createStatisticsReadTelemetry } from "./telemetry";

export async function readStatistics(campaign: string) {
	const telemetry = createStatisticsReadTelemetry();
	try {
		const client = editDataClient();
		if (!client) throw new Error("Statistics connection unavailable");
		const value = await collectStatistics(campaign, {
			async sessions(slug, after) {
				telemetry.request("sessions");
				let query = client
					.from("sessions")
					.select("id,title,session_date,duration_ms,campaigns!inner(slug)")
					.eq("campaigns.slug", slug)
					.order("id")
					.limit(200);
				if (after) query = query.gt("id", after);
				const { data, error } = await query;
				if (error) throw new Error("Statistics sessions unavailable");
				const rows = (data ?? []) as unknown as SessionRow[];
				telemetry.response("sessions", rows);
				return rows;
			},
			async segments(slug, session, after) {
				telemetry.request("segments");
				let query = client
					.from("transcript_segments")
					.select(
						"id,session_id,source_segment_id,text,sessions!inner(campaigns!inner(slug))",
					)
					.eq("sessions.campaigns.slug", slug)
					.eq("session_id", session)
					.order("id")
					.limit(1000);
				if (after) query = query.gt("id", after);
				const { data, error } = await query;
				if (error) throw new Error("Statistics transcript unavailable");
				const rows = (data ?? []) as unknown as SegmentRow[];
				telemetry.response("segments", rows);
				return rows;
			},
		});
		console.info(
			"TDA_STATS_READ_V1",
			JSON.stringify(telemetry.finish("success")),
		);
		return value;
	} catch (error) {
		console.info("TDA_STATS_READ_V1", JSON.stringify(telemetry.finish("error")));
		throw error;
	}
}
