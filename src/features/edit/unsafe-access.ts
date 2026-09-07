import "server-only";

export function isUnsafeEditEnabled(): boolean {
	return process.env.TDA_EDIT_UNSAFE === "true";
}

export function requireUnsafeEdit(): void {
	if (!isUnsafeEditEnabled()) {
		throw new Error("Unsafe Edit is disabled");
	}
}
