import "server-only";
import { createClient } from "@supabase/supabase-js";
export function publishedDataClient() {
	if (process.env.TDA_READ_PUBLISHED_DATA !== "true") return null;
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SECRET_KEY;
	if (!url || !key)
		throw new Error("Published data connection is not configured");
	return createClient(url, key, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
		global: {
			fetch: (input, init) =>
				fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
		},
	});
}
