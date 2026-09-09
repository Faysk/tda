"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./pipipi-lore-page.module.css";

export type PipipiCinematicSceneProps = {
	id: "casa" | "super-herois" | "corredores" | "cadeira" | "ultimo-dia" | "acordou";
	background: string;
	subject?: string;
	subjectWidth?: number;
	subjectHeight?: number;
	title: string;
	eyebrow: string;
	caption: string;
	motion?: "breath" | "soft" | "cinematic" | "showcase";
};

const motionAmount = {
	breath: { x: 8, y: 8, subjectY: 18, scale: 0.012 },
	soft: { x: 14, y: 12, subjectY: 28, scale: 0.024 },
	cinematic: { x: 20, y: 15, subjectY: 38, scale: 0.035 },
	showcase: { x: 26, y: 18, subjectY: 48, scale: 0.046 },
} as const;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function PipipiCinematicScene({
	id,
	background,
	subject,
	subjectWidth = 800,
	subjectHeight = 1000,
	title,
	eyebrow,
	caption,
	motion = "soft",
}: PipipiCinematicSceneProps) {
	const rootRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let frame = 0;
		let visible = false;

		const resetMotion = () => {
			root.style.setProperty("--scene-progress", "0");
			root.style.setProperty("--scene-bg-x", "0px");
			root.style.setProperty("--scene-bg-y", "0px");
			root.style.setProperty("--scene-bg-scale", "1.035");
			root.style.setProperty("--scene-subject-x", "0px");
			root.style.setProperty("--scene-subject-y", "0px");
			root.style.setProperty("--scene-subject-scale", "1");
			root.style.setProperty("--scene-copy-opacity", "1");
			root.style.setProperty("--scene-copy-y", "0px");
		};

		const render = () => {
			frame = 0;
			if (!visible) return;
			if (reducedMotion.matches) {
				resetMotion();
				return;
			}

			const rect = root.getBoundingClientRect();
			const viewport = window.innerHeight;
			const travel = Math.max(1, rect.height - viewport);
			const progress = clamp(-rect.top / travel, 0, 1);
			const centered = progress - 0.5;
			const amount = motionAmount[motion];

			root.style.setProperty("--scene-progress", progress.toFixed(4));
			root.style.setProperty("--scene-bg-x", `${centered * amount.x}px`);
			root.style.setProperty("--scene-bg-y", `${centered * amount.y}px`);
			root.style.setProperty(
				"--scene-bg-scale",
				(1.035 + progress * amount.scale).toFixed(4),
			);
			root.style.setProperty(
				"--scene-subject-x",
				`${centered * -amount.x * 1.45}px`,
			);
			root.style.setProperty(
				"--scene-subject-y",
				`${(0.5 - progress) * amount.subjectY}px`,
			);
			root.style.setProperty(
				"--scene-subject-scale",
				(0.985 + progress * amount.scale * 0.7).toFixed(4),
			);
			root.style.setProperty(
				"--scene-copy-opacity",
				clamp(progress / 0.18, 0.25, 1).toFixed(3),
			);
			root.style.setProperty(
				"--scene-copy-y",
				`${(1 - clamp(progress / 0.2, 0, 1)) * 28}px`,
			);
		};

		const schedule = () => {
			if (visible && !frame) frame = window.requestAnimationFrame(render);
		};

		const observer = new IntersectionObserver(
			(entries) => {
				visible = entries[0]?.isIntersecting ?? false;
				root.dataset.active = visible ? "true" : "false";
				if (visible) schedule();
			},
			{ rootMargin: "20% 0%" },
		);
		observer.observe(root);

		const onMotionPreferenceChange = () => {
			if (reducedMotion.matches) resetMotion();
			else schedule();
		};

		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule, { passive: true });
		reducedMotion.addEventListener("change", onMotionPreferenceChange);

		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			reducedMotion.removeEventListener("change", onMotionPreferenceChange);
			if (frame) window.cancelAnimationFrame(frame);
			delete root.dataset.active;
		};
	}, [motion]);

	return (
		<section
			className={styles.cinematicScene}
			data-scene={id}
			data-motion={motion}
			ref={rootRef}
			aria-label={title}
		>
			<div className={styles.cinematicStage}>
				<div className={styles.cinematicMedia} aria-hidden="true">
					<Image
						className={styles.sceneBackground}
						src={background}
						alt=""
						fill
						sizes="100vw"
						quality={88}
					/>
					{subject ? (
						<Image
							className={styles.sceneSubject}
							src={subject}
							alt=""
							width={subjectWidth}
							height={subjectHeight}
							sizes="(max-width: 760px) 78vw, 58vw"
						/>
					) : null}
					<div className={styles.sceneShade} />
				</div>

				<div className={styles.sceneCopy}>
					<p className={styles.sceneEyebrow}>{eyebrow}</p>
					<h3>{title}</h3>
					<p>{caption}</p>
				</div>

				<div className={styles.sceneProgress} aria-hidden="true">
					<span />
				</div>
			</div>
		</section>
	);
}
