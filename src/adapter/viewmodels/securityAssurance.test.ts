import { expect, it } from "vitest";
import requirements from "../../../security/requirements.json";
import { buildSecurityAssurance } from "./securityAssurance";

const view = buildSecurityAssurance();
const shown = view.gates.flatMap((group) => group.checks);

it("explains every check the CI requires, once each, and nothing the CI does not run", () => {
	expect(shown.map((check) => check.id).sort()).toEqual(
		requirements.required.map((requirement) => requirement.id).sort(),
	);
});

it("cites the ASVS numbers from the CI requirements, not a copy", () => {
	for (const requirement of requirements.required) {
		expect(shown.find((check) => check.id === requirement.id)?.asvs).toEqual(requirement.asvs);
	}
	expect(view.standard).toBe(requirements.standard);
});

it("states each area the CI leaves unverified", () => {
	expect(view.limits.length).toBeGreaterThanOrEqual(requirements.pending.length);
	const asvs = view.limits.flatMap((limit) => limit.asvs);
	for (const pending of requirements.pending) {
		for (const number of pending.asvs) {
			expect(asvs, number).toContain(number);
		}
	}
});

it("has plain text for every guarantee", () => {
	for (const check of shown) {
		expect(check.title.length, check.id).toBeGreaterThan(0);
		expect(check.guarantee.length, check.id).toBeGreaterThan(0);
	}
	expect(view.misuse.length).toBeGreaterThan(0);
	expect(view.attacks.length).toBeGreaterThan(0);
	expect(view.watch.length).toBeGreaterThan(0);
});
