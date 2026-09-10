export function GET() {
	const commit =
		process.env.APP_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null;
	return Response.json(
		{
			application: "tda",
			environment:
				process.env.APP_ENV || process.env.VERCEL_ENV || "development",
			commit,
			release: process.env.TDA_RELEASE_ID || commit,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}
