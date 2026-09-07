import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: "72px 80px",
				background: "#0a0c0f",
				color: "#eee8dc",
			}}
		>
			<div
				style={{
					display: "flex",
					fontSize: 30,
					fontWeight: 700,
					letterSpacing: "0.18em",
					color: "#d7aa61",
				}}
			>
				TDA
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
				<div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>
					Tem Dado Aqui
				</div>
				<div style={{ display: "flex", fontSize: 32, color: "#c8c2b7" }}>
					Histórias que ficam com a gente.
				</div>
			</div>
			<div style={{ display: "flex", fontSize: 24, color: "#9aa1aa" }}>
				dnd.faysk.dev
			</div>
		</div>,
		{
			width: 1200,
			height: 630,
		},
	);
}
