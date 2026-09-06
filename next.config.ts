import type { NextConfig } from "next";

const config: NextConfig = {
	poweredByHeader: false,
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "dmrqnbdvbkfqzctcerbx.supabase.co",
				pathname: "/storage/v1/object/public/session-images/**",
			},
			{
				protocol: "https",
				hostname: "raw.githubusercontent.com",
				pathname: "/Faysk/dnd-scribe/**",
			},
			{
				protocol: "https",
				hostname: "dnd.faysk.dev",
				pathname: "/assets/sessions/**",
			},
		],
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
				],
			},
		];
	},
};

export default config;
