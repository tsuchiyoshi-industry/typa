import { describe, expect, it } from "vitest";
import {
	assertSecurityChecks,
	assertZapExecution,
	assertZapReport,
	type CheckResult,
	redactSecurityText,
	ZAP_RULE_TESTS,
} from "../../../scripts/securityEvidence";
import policy from "../../../security/requirements.json";

const passed = (): CheckResult[] =>
	policy.required.map(({ id }) => ({ id, status: "passed", durationMs: 1 }));
const report = () => ({
	"@version": "2.17.0",
	site: [{ "@name": "http://typa_release_rest:3000", alerts: [{ riskcode: "1" }] }],
});

describe("security evidence gate", () => {
	const execution = () =>
		[
			"Automation plan succeeded!",
			...Object.values(ZAP_RULE_TESTS).map(
				(name) => `Job activeScan test of type stats passed: ${name} [12 >= 1]`,
			),
			"The active scanner finished without being stopped [0 == 0]",
			...[
				"Protected document contains the owner's marker",
				"Session is linked to the expected employee",
				"Protected document remains accessible after attacks",
			].map((name) => `Job requestor test type url has passed. Test Name: ${name}.`),
		].join("\n");
	it("requires real attack and authentication coverage in addition to a clean alert report", () => {
		expect(Object.keys(assertZapExecution(execution()))).toHaveLength(5);
		for (const broken of [
			execution().replace("[12 >= 1]", "[0 >= 1]"),
			execution().replace("The active scanner finished without being stopped [0 == 0]", ""),
			execution().replace("Session is linked to the expected employee", "missing"),
			`${execution()}\nAutomation plan warnings:`,
		]) {
			expect(() => assertZapExecution(broken)).toThrow();
		}
	});
	it("accepts evidence for every mandatory check", () => {
		expect(() => assertSecurityChecks(passed())).not.toThrow();
	});
	it("rejects zero executed checks", () => {
		expect(() => assertSecurityChecks([])).toThrow("Missing");
	});
	it("rejects a missing, failed, duplicate or unrelated check", () => {
		const missing = passed().slice(1);
		const failed = passed();
		failed[0].status = "failed";
		const duplicate = passed();
		duplicate[0] = duplicate[1];
		const unrelated = passed();
		unrelated[0].id = "unknown";
		for (const evidence of [missing, failed, duplicate, unrelated]) {
			expect(() => assertSecurityChecks(evidence)).toThrow();
		}
	});
	it("rejects a scan with no sites or an unrelated target", () => {
		expect(() => assertZapReport({ "@version": "2.17.0", site: [] })).toThrow();
		const changed = report();
		changed.site[0]["@name"] = "https://unrelated.example";
		expect(() => assertZapReport(changed)).toThrow();
	});
	it("rejects an unexpected scanner version or malformed report", () => {
		for (const value of [null, {}, { ...report(), "@version": "0.0.0" }]) {
			expect(() => assertZapReport(value)).toThrow();
		}
	});
	it.each(["2", "3", "unknown"])("rejects alert risk %s", (riskcode) => {
		const changed = report();
		changed.site[0].alerts = [{ riskcode }];
		expect(() => assertZapReport(changed)).toThrow();
	});
	it("retains Low findings as evidence without pretending they are absent", () => {
		expect(assertZapReport(report())).toEqual({ version: "2.17.0", alerts: 1 });
	});
	it("redacts exact tokens, refresh tokens, passwords and other JWTs from artifacts", () => {
		const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.signature";
		const text = JSON.stringify({
			request: `Authorization: Bearer ${token}`,
			refresh: "refresh-secret",
			password: "password-secret",
		});
		const sanitized = redactSecurityText(text, ["refresh-secret", "password-secret"]);
		expect(sanitized).not.toMatch(/signature|refresh-secret|password-secret/);
		expect(JSON.parse(sanitized)).toHaveProperty("request", "Authorization: Bearer [REDACTED-JWT]");
	});
});
