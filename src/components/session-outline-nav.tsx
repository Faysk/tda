"use client";

import { useEffect, useMemo, useState } from "react";
import { Select, type SelectOption } from "@/components/ui";
import type { StoryOutlineEntry } from "@/features/sessions/story-outline";
import styles from "./session-outline-nav.module.css";

const LONG_OUTLINE_THRESHOLD = 12;

export function SessionOutlineNav({
	entries,
}: Readonly<{ entries: readonly StoryOutlineEntry[] }>) {
	const [activeId, setActiveId] = useState(entries[0]?.id ?? "");
	const compact = entries.length > LONG_OUTLINE_THRESHOLD;
	const baseLevel = useMemo(
		() => Math.min(...entries.map((entry) => entry.level)),
		[entries],
	);
	const outlineOptions = useMemo<readonly SelectOption<string>[]>(
		() =>
			entries.map((entry) => ({
				value: entry.id,
				label: `${"› ".repeat(Math.max(0, entry.level - baseLevel))}${entry.text}`,
			})),
		[baseLevel, entries],
	);

	useEffect(() => {
		const fromHash = decodeURIComponent(window.location.hash.slice(1));
		if (entries.some((entry) => entry.id === fromHash)) setActiveId(fromHash);

		const elements = entries.flatMap((entry) => {
			const element = document.getElementById(entry.id);
			return element ? [element] : [];
		});
		if (!elements.length) return;

		const observer = new IntersectionObserver(
			(records) => {
				const visible = records
					.filter((record) => record.isIntersecting)
					.sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
				if (!visible.length) return;

				const hashId = decodeURIComponent(window.location.hash.slice(1));
				const explicitTarget = visible.find((record) => record.target.id === hashId);
				const id = explicitTarget?.target.id ?? visible[0]?.target.id;
				if (id) setActiveId(id);
			},
			{ rootMargin: "-18% 0px -68% 0px", threshold: 0 },
		);
		for (const element of elements) observer.observe(element);
		return () => observer.disconnect();
	}, [entries]);

	function navigate(id: string) {
		const target = document.getElementById(id);
		if (!target) return;
		window.location.hash = id;
		target.focus({ preventScroll: true });
		target.scrollIntoView({
			block: "start",
			behavior: "auto",
		});
		setActiveId(id);
	}

	if (!entries.length) return null;

	return (
		<nav className={styles.root} aria-label="Nesta sessão">
			<details className={styles.disclosure}>
				<summary className={styles.summary}>
					<span>Nesta sessão</span>
					<span className={styles.count}>{entries.length} seções</span>
				</summary>
				<div className={styles.panel}>
					{compact ? (
						<div className={styles.selectLabel}>
							<span>Ir para um trecho</span>
							<Select
								value={activeId}
								options={outlineOptions}
								onChange={navigate}
								ariaLabel="Ir para uma seção"
								restoreFocusOnSelect={false}
							/>
						</div>
					) : (
						<ol className={styles.list}>
							{entries.map((entry) => (
								<li
									key={entry.id}
									className={entry.level > baseLevel ? styles.child : undefined}
								>
									<a
										href={`#${entry.id}`}
										aria-current={entry.id === activeId ? "location" : undefined}
									>
										{entry.text}
									</a>
								</li>
							))}
						</ol>
					)}
					<a className={styles.topLink} href="#topo-da-sessao">
						Voltar ao topo
					</a>
				</div>
			</details>
		</nav>
	);
}
