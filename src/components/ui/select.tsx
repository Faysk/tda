"use client";

import {
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { classNames } from "./class-names";
import styles from "./select.module.css";

export type SelectOption<T extends string = string> = Readonly<{
	value: T;
	label: string;
	disabled?: boolean;
}>;

type SelectProps<T extends string> = Readonly<{
	value: T;
	options: readonly SelectOption<T>[];
	onChange: (value: T) => void;
	ariaLabel: string;
	className?: string;
	disabled?: boolean;
}>;

function firstEnabledIndex<T extends string>(options: readonly SelectOption<T>[]) {
	return options.findIndex((option) => !option.disabled);
}

function lastEnabledIndex<T extends string>(options: readonly SelectOption<T>[]) {
	for (let index = options.length - 1; index >= 0; index -= 1) {
		if (!options[index]?.disabled) return index;
	}
	return -1;
}

function nextEnabledIndex<T extends string>(
	options: readonly SelectOption<T>[],
	current: number,
	direction: 1 | -1,
) {
	if (!options.length) return -1;
	let index = current;
	for (let attempts = 0; attempts < options.length; attempts += 1) {
		index = (index + direction + options.length) % options.length;
		if (!options[index]?.disabled) return index;
	}
	return current;
}

export function Select<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
	className,
	disabled = false,
}: SelectProps<T>) {
	const [open, setOpen] = useState(false);
	const selectedIndex = options.findIndex((option) => option.value === value);
	const [activeIndex, setActiveIndex] = useState(
		selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options),
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const selected = options[selectedIndex] ?? options[firstEnabledIndex(options)];

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const nextIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options);
		setActiveIndex(nextIndex);
		requestAnimationFrame(() => listboxRef.current?.focus());
	}, [open, options, selectedIndex]);

	useEffect(() => {
		if (!open || activeIndex < 0) return;
		const optionId = `${baseId}-option-${activeIndex}`;
		document.getElementById(optionId)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, baseId, open]);

	function closeAndFocusTrigger() {
		setOpen(false);
		requestAnimationFrame(() => triggerRef.current?.focus());
	}

	function choose(index: number) {
		const option = options[index];
		if (!option || option.disabled) return;
		onChange(option.value);
		closeAndFocusTrigger();
	}

	function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (disabled) return;
		if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
			event.preventDefault();
			if (!open) {
				const preferred =
					event.key === "ArrowUp"
						? lastEnabledIndex(options)
						: selectedIndex >= 0
							? selectedIndex
							: firstEnabledIndex(options);
				setActiveIndex(preferred);
				setOpen(true);
			}
		}
	}

	function handleListboxKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex((index) => nextEnabledIndex(options, index, 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex((index) => nextEnabledIndex(options, index, -1));
				break;
			case "Home":
				event.preventDefault();
				setActiveIndex(firstEnabledIndex(options));
				break;
			case "End":
				event.preventDefault();
				setActiveIndex(lastEnabledIndex(options));
				break;
			case "Enter":
			case " ":
				event.preventDefault();
				choose(activeIndex);
				break;
			case "Escape":
				event.preventDefault();
				closeAndFocusTrigger();
				break;
			case "Tab":
				setOpen(false);
				break;
			default:
				if (event.key.length === 1 && /\S/.test(event.key)) {
					const needle = event.key.toLocaleLowerCase("pt-BR");
					const start = activeIndex >= 0 ? activeIndex : 0;
					for (let offset = 1; offset <= options.length; offset += 1) {
						const index = (start + offset) % options.length;
						const option = options[index];
						if (
							option &&
							!option.disabled &&
							option.label.toLocaleLowerCase("pt-BR").startsWith(needle)
						) {
							setActiveIndex(index);
							break;
						}
					}
				}
		}
	}

	return (
		<div ref={rootRef} className={classNames(styles.root, className)}>
			<button
				ref={triggerRef}
				type="button"
				className={styles.trigger}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listboxId}
				disabled={disabled}
				onClick={() => setOpen((value) => !value)}
				onKeyDown={handleTriggerKeyDown}
			>
				<span className={styles.value}>{selected?.label ?? "Selecionar"}</span>
				<svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
					<path d="m4 6 4 4 4-4" />
				</svg>
			</button>

			{open ? (
				<div
					ref={listboxRef}
					id={listboxId}
					className={styles.popover}
					role="listbox"
					aria-label={ariaLabel}
					aria-activedescendant={
						activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined
					}
					tabIndex={-1}
					onKeyDown={handleListboxKeyDown}
				>
					{options.map((option, index) => (
						<button
							key={option.value}
							id={`${baseId}-option-${index}`}
							type="button"
							className={classNames(
								styles.option,
								index === activeIndex ? styles.optionActive : undefined,
							)}
							role="option"
							aria-selected={option.value === value}
							disabled={option.disabled}
							tabIndex={-1}
							onMouseEnter={() => !option.disabled && setActiveIndex(index)}
							onClick={() => choose(index)}
						>
							<span>{option.label}</span>
							{option.value === value ? (
								<svg viewBox="0 0 16 16" aria-hidden="true">
									<path d="m3.5 8 2.8 2.8 6.2-6.2" />
								</svg>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
