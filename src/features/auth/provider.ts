import "server-only";
import { authConfig } from "./config";

export async function discordAvailable(): Promise<boolean> {
	const config = authConfig();
	if (!config) return false;
	try {
		const response = await fetch(`${config.url}/auth/v1/settings`, {
			headers: { apikey: config.key },
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return false;
		const settings = await response.json();
		return settings.external?.discord === true;
	} catch {
		return false;
	}
}
