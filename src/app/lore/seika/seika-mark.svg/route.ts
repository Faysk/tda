export const dynamic = "force-static";

const SOURCE_SHA256 = "3cd49a180a0702e4c84bb91dd5890d2bf3082a224b047bc0bdf512bd90ac30a0";
const BODY = Buffer.from("PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTYiIGZpbGw9IiMxNzEzMGYiLz4KICA8Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIyMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjYzdhMTY0IiBzdHJva2Utd2lkdGg9IjIiLz4KICA8cGF0aCBkPSJNMjIgMjNsNC05IDYgNyA2LTcgNCA5YzUgNCA4IDEwIDggMTYgMCAxMC04IDE4LTE4IDE4UzE0IDQ5IDE0IDM5YzAtNiAzLTEyIDgtMTZ6IiBmaWxsPSJub25lIiBzdHJva2U9IiNlN2NmOWEiIHN0cm9rZS13aWR0aD0iMi4yIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CiAgPHBhdGggZD0iTTI0IDM3YzIgMiA0IDMgOCAzczYtMSA4LTNNMjggMzFoLjFNMzYgMzFoLjEiIHN0cm9rZT0iIzlmODFkNiIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSIvPgo8L3N2Zz4K", "base64").toString("utf8");

export function GET() {
	return new Response(BODY, {
		headers: {
			"Content-Type": "image/svg+xml; charset=utf-8",
			"Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
			"X-Seika-Source-SHA256": SOURCE_SHA256,
		},
	});
}
