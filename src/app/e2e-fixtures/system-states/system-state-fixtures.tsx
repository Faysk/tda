"use client";

import { useState } from "react";
import GlobalErrorPage from "@/app/error";
import LembraError from "@/app/lembra/error";

export function GlobalErrorFixture() {
	const [attempts, setAttempts] = useState(0);

	return (
		<>
			<GlobalErrorPage
				key={attempts}
				reset={() => setAttempts((current) => current + 1)}
			/>
			<output data-retry-count="global" hidden>
				{attempts}
			</output>
		</>
	);
}

export function LembraErrorFixture() {
	const [attempts, setAttempts] = useState(0);

	return (
		<>
			<LembraError
				error={new Error("Synthetic Lembra fixture error")}
				reset={() => setAttempts((current) => current + 1)}
			/>
			<output data-retry-count="lembra" hidden>
				{attempts}
			</output>
		</>
	);
}
