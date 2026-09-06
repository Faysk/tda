"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
	return (
		<section className="page-section">
			<h1>Não foi possível abrir esta história.</h1>
			<button className="button" type="button" onClick={reset}>
				Tentar novamente
			</button>
		</section>
	);
}
