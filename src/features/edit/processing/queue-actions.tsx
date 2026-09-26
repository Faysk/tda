"use client";

import {
	type ReactNode,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./queue-view.module.css";

// A disclosure of ordinary buttons, not an ARIA menu with arrow-key navigation.
export function QueueActions({
	label,
	children,
}: Readonly<{
	label: string;
	children: (close: () => void) => ReactNode;
}>) {
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const popup = useRef<HTMLFieldSetElement>(null);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{
		left: number;
		top: number;
	} | null>(null);

	function close(restoreFocus = true) {
		setOpen(false);
		setPosition(null);
		if (restoreFocus) trigger.current?.focus({ preventScroll: true });
	}

	useLayoutEffect(() => {
		if (!open) return;
		const button = trigger.current;
		const menu = popup.current;
		if (!button || !menu) return;
		const anchor = button.getBoundingClientRect();
		const box = menu.getBoundingClientRect();
		const above = anchor.top - 8;
		const below = window.innerHeight - anchor.bottom - 8;
		const top =
			below < box.height + 6 && above > below
				? anchor.top - box.height - 6
				: anchor.bottom + 6;
		setPosition({
			left: Math.max(
				8,
				Math.min(anchor.right - box.width, window.innerWidth - box.width - 8),
			),
			top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)),
		});
		menu
			.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus({ preventScroll: true });

		const dismiss = (restoreFocus: boolean) => {
			setOpen(false);
			setPosition(null);
			if (restoreFocus) button.focus({ preventScroll: true });
		};
		const outside = (event: Event) => {
			if (
				event.target instanceof Node &&
				!menu.contains(event.target) &&
				!button.contains(event.target)
			)
				dismiss(false);
		};
		const scroll = (event: Event) => {
			// Keep internal scrolling usable on very short viewports.
			if (event.target instanceof Node && menu.contains(event.target)) return;
			const current = button.getBoundingClientRect();
			if (
				Math.abs(current.top - anchor.top) > 0.5 ||
				Math.abs(current.left - anchor.left) > 0.5
			)
				dismiss(true);
		};
		const resize = () => dismiss(true);
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("scroll", scroll, true);
		window.addEventListener("resize", resize);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("scroll", scroll, true);
			window.removeEventListener("resize", resize);
		};
	}, [open]);

	return (
		<>
			<button
				ref={trigger}
				className={styles.moreTrigger}
				type="button"
				aria-label={`Mais ações para ${label}`}
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				onClick={() => (open ? close() : setOpen(true))}
			>
				Mais
			</button>
			{open
				? createPortal(
						<fieldset
							ref={popup}
							id={id}
							aria-label={`Ações para ${label}`}
							className={styles.moreMenu}
							data-queue-actions="true"
							style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									close();
								}
								if (event.key !== "Tab") return;
								const controls = [
									...event.currentTarget.querySelectorAll<HTMLButtonElement>(
										"button:not(:disabled)",
									),
								];
								if (event.shiftKey && document.activeElement === controls[0]) {
									event.preventDefault();
									close();
								} else if (
									!event.shiftKey &&
									document.activeElement === controls.at(-1)
								) {
									event.preventDefault();
									const outsideControls = [
										...document.querySelectorAll<HTMLElement>(
											"button, a[href], input, select, textarea, [tabindex]",
										),
									].filter(
										(element) =>
											element.tabIndex >= 0 &&
											!element.matches(":disabled") &&
											element.getClientRects().length > 0 &&
											!popup.current?.contains(element),
									);
									const index = outsideControls.indexOf(
										trigger.current as HTMLButtonElement,
									);
									close(false);
									outsideControls[
										(index + 1) % outsideControls.length
									]?.focus();
								}
							}}
						>
							{children(() => close())}
						</fieldset>,
						document.body,
					)
				: null}
		</>
	);
}
