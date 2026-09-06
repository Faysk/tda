"use client";

import { Button, DisplayTitle } from "@/components/ui";

export default function ErrorPage({ reset }: { reset: () => void }) {
	return (
		<section className="page-section">
			<DisplayTitle>Não foi possível abrir esta história.</DisplayTitle>
			<Button type="button" variant="primary" onClick={reset}>
				Tentar novamente
			</Button>
		</section>
	);
}
