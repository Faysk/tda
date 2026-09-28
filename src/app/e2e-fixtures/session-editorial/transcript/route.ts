import { NextResponse } from "next/server";

const PRIVATE_MARKER = "NEVER_PUBLIC_TRANSCRIPT_MARKER_9F3A";

export const dynamic = "force-dynamic";

export function GET() {
	if (process.env.TDA_E2E_FIXTURES !== "true") {
		return new NextResponse("Not Found", { status: 404 });
	}
	return new NextResponse(
		[
			"# Sessão Editorial Sintética",
			"",
			"00:00:00 · Alya",
			"Primeira fala sintética da sessão.",
			"",
			"00:00:12 · Dandelion",
			`Trecho privado ${PRIVATE_MARKER} usado somente para provar ausência de vazamento.`,
			"",
		].join("\n"),
		{
			status: 200,
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Type": "text/markdown; charset=utf-8",
				"Content-Disposition":
					'attachment; filename="synthetic-editorial-session.md"',
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}
