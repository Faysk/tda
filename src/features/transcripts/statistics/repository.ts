import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	collectStatistics,
	collectStatisticsReadModel,
	type SegmentRow,
	type SessionRow,
	type StatisticsReadModelRow,
} from "./read";
import { createStatisticsReadTelemetry } from "./telemetry";

export function statisticsReadModelEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return env.TDA_STATS_READ_MODEL_ENABLED === "true";
}

export async function readStatistics(campaign: string) {
	const useReadModel = statisticsReadModelEnabled();
	const telemetry = createStatisticsReadTelemetry(
		useReadModel ? "read_model_v1" : "segment_scan_v1",
	);
	try {
		const client = editDataClient();
		if (!client) throw new Error("Statistics connection unavailable");

		const value = useReadModel
			? await collectStatisticsReadModel(campaign, {
					async sessions(slug, after) {
						telemetry.request("read_model");
						let query = client
							.from("transcript_statistics_read_model_v1")
							.select(
								"id,title,session_date,duration_ms,segment_count,word_count,campaign_slug",
							)
							.eq("campaign_slug", slug)
							.order("id")
							.limit(200);
						if (after) query = query.gt("id", after);
						const { data, error } = await query;
						if (error)
							throw new Error("Statistics read model unavailable");
						const rows = (data ?? []) as unknown as StatisticsReadModelRow[];
						telemetry.response("read_model", rows);
						return rows;
					},
				})
			: await collectStatistics(campaign, {
					async sessions(slug, after) {
						telemetry.request("sessions");
						let query = client
							.from("sessions")
							.select(
								"id,title,session_date,duration_ms,campaigns!inner(slug)",
							)
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
						if (error)
							throw new Error("Statistics transcript unavailable");
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
