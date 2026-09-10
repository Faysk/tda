"use client";

import { useState } from "react";
import { useGlobalLoadingFlag } from "@/components/global-loading";
import { Button, DisplayTitle } from "@/components/ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
	const [retrying, setRetrying] = useState(false);
	useGlobalLoadingFlag(retrying);

	return (
		<section className="page-section">
			<DisplayTitle>Não foi possível abrir esta história.</DisplayTitle>
			<Button
				type="button"
				variant="primary"
				disabled={retrying}
				onClick={() => {
					setRetrying(true);
					reset();
				}}
			>
				Tentar novamente
			</Button>
		</section>
	);
}
