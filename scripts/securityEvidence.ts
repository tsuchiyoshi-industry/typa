import assert from "node:assert/strict";
import policy from "../security/requirements.json";

export type CheckResult = { id: string; status: "passed" | "failed"; durationMs: number };

export const ZAP_RULE_TESTS = {
	40018: "General SQL injection attacks were sent",
	40022: "PostgreSQL injection attacks were sent",
	40003: "CRLF injection attacks were sent",
	6: "Path traversal attacks were sent",
	90019: "Server code injection attacks were sent",
};

/** Pinned ZAP 2.17.0 progress format; missing/deleted AF tests cannot silently pass. */
export function assertZapExecution(log: string): Record<string, number> {
	assert.ok(log.includes("Automation plan succeeded!"), "ZAP plan did not succeed");
	assert.doesNotMatch(log, /Automation plan (failures|warnings):|test .*has failed/);
	const counts: Record<string, number> = {};
	for (const [rule, name] of Object.entries(ZAP_RULE_TESTS)) {
		const match = log.match(new RegExp(`test of type stats passed: ${name} \\[(\\d+) >= 1\\]`));
		assert.ok(match && Number(match[1]) >= 1, `Missing attack evidence for ZAP rule ${rule}`);
		counts[rule] = Number(match[1]);
	}
	assert.ok(
		log.includes("The active scanner finished without being stopped [0 == 0]"),
		"ZAP scanner did not finish",
	);
	for (const name of [
		"Protected document contains the owner's marker",
		"Session is linked to the expected employee",
		"Protected document remains accessible after attacks",
	]) {
		assert.ok(
			log.includes(`test type url has passed. Test Name: ${name}.`),
			"Missing authenticated ZAP coverage",
		);
	}
	return counts;
}

export function assertSecurityChecks(results: CheckResult[]): void {
	assert.equal(
		new Set(results.map((result) => result.id)).size,
		results.length,
		"Duplicate security evidence",
	);
	assert.equal(results.length, policy.required.length, "Missing security evidence");
	for (const requirement of policy.required) {
		assert.equal(
			results.find((result) => result.id === requirement.id)?.status,
			"passed",
			`Unsatisfied security requirement: ${requirement.id}`,
		);
	}
}

export function assertZapReport(value: unknown): { version: string; alerts: number } {
	const report = value as {
		"@version"?: string;
		site?: { "@name": string; alerts: { riskcode: string }[] }[];
	};
	assert.equal(report?.["@version"], "2.17.0", "Unexpected ZAP engine version");
	assert.ok(Array.isArray(report.site) && report.site.length > 0, "ZAP scanned no sites");
	let alerts = 0;
	for (const site of report.site) {
		assert.equal(site["@name"], "http://typa_release_rest:3000", "Unexpected ZAP target");
		assert.ok(Array.isArray(site.alerts), "Missing ZAP alerts section");
		for (const alert of site.alerts) {
			assert.ok(/^[0-3]$/.test(String(alert.riskcode)), "Invalid ZAP risk code");
			assert.ok(Number(alert.riskcode) < 2, "ZAP detected a Medium or High alert");
			alerts++;
		}
	}
	return { version: report["@version"], alerts };
}

/** Reports may contain request headers; only redacted copies may become CI artifacts. */
export function redactSecurityText(text: string, secrets: string[]): string {
	let redacted = text;
	for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
		redacted = redacted.split(secret).join("[REDACTED]");
	}
	return redacted.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]");
}
