export function GET() {
	return Response.json(
		{
			ok: true,
			application: "tda",
			commit:
				process.env.APP_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
			environment:
				process.env.APP_ENV || process.env.VERCEL_ENV || "development",
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}
