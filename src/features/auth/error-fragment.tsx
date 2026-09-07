"use client";

import { useEffect } from "react";

// Some GoTrue OAuth failures use a fragment, which is never sent to the server.
export function AuthErrorFragment() {
	useEffect(() => {
		const fragment = new URLSearchParams(window.location.hash.slice(1));
		const error = fragment.get("error");
		if (!error) return;
		const target = new URL(window.location.href);
		target.hash = "";
		target.searchParams.set(
			"erro",
			error === "access_denied" ? "cancelado" : "callback",
		);
		window.location.replace(`${target.pathname}${target.search}`);
	}, []);
	return null;
}
