import "server-only";
import { createClient } from "@supabase/supabase-js";

function serverDataClient(enabled: boolean, unavailableMessage: string) {
	if (!enabled) return null;
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SECRET_KEY;
	if (!url || !key) throw new Error(unavailableMessage);

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

export function publishedDataClient() {
	return serverDataClient(
		process.env.TDA_READ_PUBLISHED_DATA === "true",
		"Published data connection is not configured",
	);
}

export function editDataClient() {
	return serverDataClient(
		process.env.TDA_READ_EDIT_DATA === "true",
		"Edit data connection is not configured",
	);
}
