import { describe, expect, it } from "vitest";
import {
	humanRoleDescription,
	humanRoleName,
} from "./directory";
import type { PermissionRoleDefinition } from "./model";

function role(overrides: Partial<PermissionRoleDefinition> = {}): PermissionRoleDefinition {
	return {
		id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		name: "Billing Observer",
		slug: "billing-observer",
		description: "Legacy English description",
		plane: "project",
		isSystem: true,
		actions: ["project.costs.read", "project.deployments.read"],
		peopleCount: 1,
		delegable: false,
		delegationReason: null,
		sensitive: false,
		...overrides,
	};
}

describe("permissions human presentation", () => {
	it("translates known system role names without changing their actions", () => {
		expect(humanRoleName(role())).toBe("Observador de custos");
		expect(
			humanRoleName(role({ name: "Campaign DM", slug: "campaign-dm" })),
		).toBe("Mestre da campanha");
		expect(
			humanRoleName(role({ name: "Platform Owner", slug: "platform-owner" })),
		).toBe("Administrador da plataforma");
	});

	it("derives the visible role description from effective action labels", () => {
		const value = humanRoleDescription(role());
		expect(value).toContain("Consultar custos do projeto");
		expect(value).toContain("Consultar deployments");
		expect(value).not.toContain("project.costs.read");
		expect(value).not.toContain("Legacy English description");
	});

	it("keeps project campaign management human-readable instead of exposing the raw capability", () => {
		const value = humanRoleDescription(
			role({ actions: ["project.campaigns.manage"] }),
		);
		expect(value).toContain("Gerenciar campanhas do projeto");
		expect(value).not.toContain("project.campaigns.manage");
	});

	it("preserves custom human role names instead of guessing a translation", () => {
		expect(
			humanRoleName(
				role({
					name: "Guardião de mesa",
					slug: "custom-guardiao",
					isSystem: false,
				}),
			),
		).toBe("Guardião de mesa");
	});
});
