"use client";

import Image from "next/image";
import { useId, useState, type ReactNode } from "react";
import type { SessionComicPublishedPage } from "@/features/edit/sessions/session-comic-model";
import styles from "./session-comic-reader.module.css";

type Props = Readonly<{
	pages: readonly SessionComicPublishedPage[];
	textView: ReactNode;
}>;

export function SessionComicReader({ pages, textView }: Props) {
	const [mode, setMode] = useState<"text" | "comic">("text");
	const sectionId = useId();

	// No alternative-mode chrome for a session without published HQ pages.
	if (pages.length === 0) return <>{textView}</>;

	return (
		<section className={styles.reader} aria-label="Leitura da sessão">
			<div className={styles.switcher} role="group" aria-label="Modo de leitura">
				<button
					type="button"
					aria-pressed={mode === "text"}
					aria-controls={sectionId}
					onClick={() => setMode("text")}
				>
					Texto
				</button>
				<button
					type="button"
					aria-pressed={mode === "comic"}
					aria-controls={sectionId}
					onClick={() => setMode("comic")}
				>
					HQ
				</button>
			</div>
			<div id={sectionId}>
				{mode === "text" ? (
					textView
				) : (
					<div className={styles.comic} aria-label="Páginas ilustradas da sessão">
						<p className={styles.pageCount}>
							{pages.length} {pages.length === 1 ? "página" : "páginas"} de HQ
						</p>
						<ol className={styles.pageList}>
							{pages.map((page, index) => (
								<li className={styles.page} key={page.imageUrl}>
									<figure>
										<Image
											src={page.imageUrl}
											alt={page.altText}
											width={1000}
											height={1400}
											sizes="(max-width: 900px) 100vw, 900px"
											loading={index === 0 ? "eager" : "lazy"}
											style={{ width: "100%", height: "auto" }}
										/>
										{page.caption ? <figcaption>{page.caption}</figcaption> : null}
									</figure>
								</li>
							))}
						</ol>
					</div>
				)}
			</div>
		</section>
	);
}
