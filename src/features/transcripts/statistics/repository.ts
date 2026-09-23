import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	collectLegacyStatistics,
	type LegacySegmentRow,
} from "./legacy-read";
import {
	collectStatistics,
	type SessionAggregateRow,
	type SessionRow,
} from "./read";
import { statisticsReadModelV2Enabled } from "./rollout";
import {
	createLegacyStatisticsReadTelemetry,
	createStatisticsReadTelemetry,
} from "./telemetry";

async function readStatisticsLegacy(campaign: string) {
	const telemetry = createLegacyStatisticsReadTelemetry();
	try {
		const client = editDataClient();
		if (!client) throw new Error("Statistics connection unavailable");
		const value = await collectLegacyStatistics(campaign, {
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
				const rows = (data ?? []) as unknown as LegacySegmentRow[];
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
		console.info(
			"TDA_STATS_READ_V1",
			JSON.stringify(telemetry.finish("error")),
		);
		throw error;
	}
}

async function readStatisticsV2(campaign: string) {
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
		console.info(
			"TDA_STATS_READ_V2",
			JSON.stringify(telemetry.finish("error")),
		);
		throw error;
	}
}

export async function readStatistics(campaign: string) {
	return statisticsReadModelV2Enabled()
		? readStatisticsV2(campaign)
		: readStatisticsLegacy(campaign);
}
