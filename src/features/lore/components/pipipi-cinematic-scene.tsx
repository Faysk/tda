"use client";

import Image from "next/image";
import { type CSSProperties, useEffect, useRef } from "react";
import {
	DEFAULT_MOBILE_CINEMATIC_MOTION,
	type CinematicSceneArtDirection,
} from "../art-directions/cinematic";
import polishStyles from "./pipipi-lore-polish.module.css";
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
	artDirection?: CinematicSceneArtDirection;
};

const motionAmount = {
	breath: { x: 8, y: 8, subjectY: 18, scale: 0.012 },
	soft: { x: 14, y: 12, subjectY: 28, scale: 0.024 },
	cinematic: { x: 20, y: 15, subjectY: 38, scale: 0.035 },
	showcase: { x: 26, y: 18, subjectY: 48, scale: 0.046 },
} as const;

type SceneCssVariables = CSSProperties & {
	"--scene-focus-x": string;
	"--scene-focus-y": string;
	"--scene-mobile-focus-x": string;
	"--scene-mobile-focus-y": string;
};

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
	artDirection,
}: PipipiCinematicSceneProps) {
	const rootRef = useRef<HTMLElement>(null);
	const desktopFocus = artDirection?.focalPoint ?? { x: 50, y: 50 };
	const mobileFocus = artDirection?.mobileFocalPoint ?? desktopFocus;
	const staticMedia = artDirection?.staticMedia === true;
	const sceneStyle: SceneCssVariables = {
		"--scene-focus-x": `${desktopFocus.x}%`,
		"--scene-focus-y": `${desktopFocus.y}%`,
		"--scene-mobile-focus-x": `${mobileFocus.x}%`,
		"--scene-mobile-focus-y": `${mobileFocus.y}%`,
	};

	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		const compactViewport = window.matchMedia("(max-width: 900px)");
		const mobileMotion = {
			...DEFAULT_MOBILE_CINEMATIC_MOTION,
			...artDirection?.mobileMotion,
		};
		let frame = 0;
		let visible = false;

		const resetMotion = () => {
			root.style.setProperty("--scene-progress", "0");
			root.style.setProperty("--scene-bg-x", "0px");
			root.style.setProperty("--scene-bg-y", "0px");
			root.style.setProperty(
				"--scene-bg-scale",
				compactViewport.matches ? "1.018" : "1.035",
			);
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
			const isCompact = compactViewport.matches;
			const backgroundXScale = isCompact ? mobileMotion.backgroundX : 1;
			const backgroundYScale = isCompact ? mobileMotion.backgroundY : 1;
			const subjectXScale = isCompact ? mobileMotion.subjectX : 1;
			const subjectYScale = isCompact ? mobileMotion.subjectY : 1;
			const zoomScale = isCompact ? mobileMotion.scale : 1;
			const baseScale = isCompact ? 1.018 : 1.035;

			root.style.setProperty("--scene-progress", progress.toFixed(4));

			if (staticMedia) {
				root.style.setProperty("--scene-bg-x", "0px");
				root.style.setProperty("--scene-bg-y", "0px");
				root.style.setProperty("--scene-bg-scale", baseScale.toFixed(3));
				root.style.setProperty("--scene-subject-x", "0px");
				root.style.setProperty("--scene-subject-y", "0px");
				root.style.setProperty("--scene-subject-scale", "1");
			} else {
				root.style.setProperty(
					"--scene-bg-x",
					`${centered * amount.x * backgroundXScale}px`,
				);
				root.style.setProperty(
					"--scene-bg-y",
					`${centered * amount.y * backgroundYScale}px`,
				);
				root.style.setProperty(
					"--scene-bg-scale",
					(baseScale + progress * amount.scale * zoomScale).toFixed(4),
				);
				root.style.setProperty(
					"--scene-subject-x",
					`${centered * -amount.x * 1.45 * subjectXScale}px`,
				);
				root.style.setProperty(
					"--scene-subject-y",
					`${(0.5 - progress) * amount.subjectY * subjectYScale}px`,
				);
				root.style.setProperty(
					"--scene-subject-scale",
					(0.985 + progress * amount.scale * 0.7 * zoomScale).toFixed(4),
				);
			}

			root.style.setProperty(
				"--scene-copy-opacity",
				clamp(progress / 0.18, 0.25, 1).toFixed(3),
			);
			root.style.setProperty(
				"--scene-copy-y",
				`${(1 - clamp(progress / 0.2, 0, 1)) * (isCompact ? 14 : 28)}px`,
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

		const onViewportClassChange = () => {
			resetMotion();
			schedule();
		};

		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule, { passive: true });
		reducedMotion.addEventListener("change", onMotionPreferenceChange);
		compactViewport.addEventListener("change", onViewportClassChange);

		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			reducedMotion.removeEventListener("change", onMotionPreferenceChange);
			compactViewport.removeEventListener("change", onViewportClassChange);
			if (frame) window.cancelAnimationFrame(frame);
			delete root.dataset.active;
		};
	}, [artDirection, motion, staticMedia]);

	return (
		<section
			className={styles.cinematicScene}
			data-scene={id}
			data-motion={motion}
			data-static-media={staticMedia ? "true" : undefined}
			ref={rootRef}
			style={sceneStyle}
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
							className={`${styles.sceneSubject} ${id === "corredores" ? polishStyles.corridorSubject : ""}`}
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
