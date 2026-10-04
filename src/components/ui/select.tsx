"use client";

import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { classNames } from "./class-names";
import styles from "./select.module.css";

export type SelectOption<T extends string = string> = Readonly<{
	value: T;
	label: string;
	disabled?: boolean;
}>;

export type SelectProps<T extends string> = Readonly<{
	value?: T;
	defaultValue?: T;
	options: readonly SelectOption<T>[];
	onChange?: (value: T) => void;
	ariaLabel: string;
	id?: string;
	ariaDescribedBy?: string;
	ariaInvalid?: boolean;
	className?: string;
	disabled?: boolean;
	embedded?: boolean;
	compact?: boolean;
	name?: string;
	required?: boolean;
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
	defaultValue,
	options,
	onChange,
	ariaLabel,
	id,
	ariaDescribedBy,
	ariaInvalid,
	className,
	disabled = false,
	embedded = false,
	compact = false,
	name,
	required = false,
}: SelectProps<T>) {
	const fallbackValue =
		defaultValue ??
		options.find((option) => !option.disabled)?.value ??
		("" as T);
	const [internalValue, setInternalValue] = useState<T>(fallbackValue);
	const currentValue = value ?? internalValue;
	const [open, setOpen] = useState(false);
	const [requiredMissing, setRequiredMissing] = useState(false);
	const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
	const selectedIndex = options.findIndex((option) => option.value === currentValue);
	const [activeIndex, setActiveIndex] = useState(
		selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options),
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

	useEffect(() => {
		if (value !== undefined || !name) return;
		const form = triggerRef.current?.form;
		if (!form) return;
		const handleReset = () => setInternalValue(fallbackValue);
		form.addEventListener("reset", handleReset);
		return () => form.removeEventListener("reset", handleReset);
	}, [fallbackValue, name, value]);

	useEffect(() => {
		if (!required) return;
		const form = triggerRef.current?.form;
		if (!form) return;
		const handleSubmit = (event: SubmitEvent) => {
			if (currentValue) return;
			event.preventDefault();
			setRequiredMissing(true);
			setOpen(true);
			requestAnimationFrame(() => triggerRef.current?.focus());
		};
		form.addEventListener("submit", handleSubmit);
		return () => form.removeEventListener("submit", handleSubmit);
	}, [currentValue, required]);

	useLayoutEffect(() => {
		if (!open) return;
		const updatePosition = () => {
			const trigger = triggerRef.current;
			if (!trigger) return;
			const rect = trigger.getBoundingClientRect();
			const viewportPadding = 8;
			const gap = 7;
			const preferredMaxHeight = Math.min(320, window.innerHeight * 0.46);
			const preferredWidth = rect.width + (embedded ? 58 : 0);
			const width = Math.min(
				Math.max(rect.width, preferredWidth),
				Math.max(120, window.innerWidth - viewportPadding * 2),
			);
			const naturalLeft = rect.left - (embedded ? 58 : 0);
			const left = Math.min(
				Math.max(viewportPadding, naturalLeft),
				Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
			);
			const below = window.innerHeight - rect.bottom - gap - viewportPadding;
			const above = rect.top - gap - viewportPadding;
			const openUp = below < Math.min(180, preferredMaxHeight) && above > below;
			const available = Math.max(96, openUp ? above : below);
			setPopoverStyle({
				left,
				width,
				maxHeight: Math.min(preferredMaxHeight, available),
				...(openUp
					? { bottom: window.innerHeight - rect.top + gap, top: "auto" }
					: { top: rect.bottom + gap, bottom: "auto" }),
			});
		};
		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [embedded, open]);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (
				!rootRef.current?.contains(target) &&
				!listboxRef.current?.contains(target)
			) {
				setOpen(false);
			}
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
		if (value === undefined) setInternalValue(option.value);
		setRequiredMissing(false);
		onChange?.(option.value);
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
		<div
			ref={rootRef}
			className={classNames(
				styles.root,
				embedded ? styles.embedded : undefined,
				compact ? styles.compact : undefined,
				className,
			)}
			data-open={open ? "true" : "false"}
		>
			{name ? (
				<input
					type="hidden"
					name={name}
					value={currentValue}
					disabled={disabled}
					data-select-hidden-input="true"
				/>
			) : null}
			<button
				ref={triggerRef}
				id={id}
				type="button"
				className={styles.trigger}
				aria-label={ariaLabel}
				data-value={currentValue}
				data-form-control-name={name}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listboxId}
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid || requiredMissing || undefined}
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				onKeyDown={handleTriggerKeyDown}
			>
				<span className={styles.value}>{selected?.label ?? "Selecionar"}</span>
				<svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true">
					<path d="m4 6 4 4 4-4" />
				</svg>
			</button>

			{open && typeof document !== "undefined"
				? createPortal(
						<div
							ref={listboxRef}
							id={listboxId}
							className={styles.popover}
							data-select-popover="true"
							style={popoverStyle}
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
									data-value={option.value}
									aria-selected={option.value === currentValue}
									disabled={option.disabled}
									tabIndex={-1}
									onMouseEnter={() => !option.disabled && setActiveIndex(index)}
									onClick={() => choose(index)}
								>
									<span>{option.label}</span>
									{option.value === currentValue ? (
										<svg viewBox="0 0 16 16" aria-hidden="true">
											<path d="m3.5 8 2.8 2.8 6.2-6.2" />
										</svg>
									) : null}
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
