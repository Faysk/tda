"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { legacyHashTarget } from "@/features/sessions/legacy-route";

export function LegacyRouteBridge() {
	const router = useRouter();

	useEffect(() => {
		const redirectLegacyHash = () => {
			const target = legacyHashTarget(window.location.hash);
			if (target) router.replace(target);
		};

		redirectLegacyHash();
		window.addEventListener("hashchange", redirectLegacyHash);
		return () => window.removeEventListener("hashchange", redirectLegacyHash);
	}, [router]);

	return null;
}
