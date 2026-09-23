import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	collectStatistics,
	type SessionAggregateRow,
	type SessionRow,
} from "./read";
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
			async aggregates(slug, sessionIds) {
				if (!sessionIds.length) return [];
				telemetry.request("aggregates");
				const { data, error } = await client
					.from("transcript_session_statistics")
					.select(
						"session_id,segment_count,complete_text_count,word_count,sessions!inner(campaigns!inner(slug))",
					)
					.eq("sessions.campaigns.slug", slug)
					.in("session_id", [...sessionIds])
					.limit(sessionIds.length);
				if (error) throw new Error("Statistics aggregate unavailable");
				const rows = (data ?? []) as unknown as SessionAggregateRow[];
				telemetry.response("aggregates", rows);
				return rows;
			},
		});
		console.info(
			"TDA_STATS_READ_V2",
			JSON.stringify(telemetry.finish("success")),
		);
		return value;
	} catch (error) {
		console.info("TDA_STATS_READ_V2", JSON.stringify(telemetry.finish("error")));
		throw error;
	}
}
