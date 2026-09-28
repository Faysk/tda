import { describe, expect, it } from "vitest";
import {
	accountInitials,
	isAuthenticatedAccountState,
	loginHrefForPath,
} from "./account-menu-model";

describe("account menu model", () => {
	it("derives compact initials without inventing an identity", () => {
		expect(accountInitials("Renan Silva")).toBe("RS");
		expect(accountInitials("Pipipi")).toBe("PI");
		expect(accountInitials("A")).toBe("A");
		expect(accountInitials(null)).toBeNull();
	});

	it("keeps login return paths local and encoded", () => {
		expect(loginHrefForPath("/mundo")).toBe("/entrar?next=%2Fmundo");
		expect(loginHrefForPath("//outside")).toBe("/entrar?next=%2F");
	});

	it("does not confuse unavailable or anonymous auth with authenticated state", () => {
		expect(isAuthenticatedAccountState("authenticated_linked")).toBe(true);
		expect(isAuthenticatedAccountState("authenticated_unlinked")).toBe(true);
		expect(isAuthenticatedAccountState("anonymous")).toBe(false);
		expect(isAuthenticatedAccountState("unavailable")).toBe(false);
	});
});
