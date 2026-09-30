"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export type FormSubmitButtonProps = Omit<ButtonProps, "pending" | "type">;

export function FormSubmitButton(props: FormSubmitButtonProps) {
	const { pending } = useFormStatus();

	return <Button {...props} pending={pending} type="submit" />;
}
