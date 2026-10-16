import { expect, it } from "vitest";
import { assertReleaseVersion, readReleaseVersions } from "../../scripts/releaseVersion";

it("requires all packaged versions to agree with the release tag", () => {
	const versions = readReleaseVersions(
		new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
	);
	const current = versions["package.json"];
	expect(() => assertReleaseVersion(current, versions)).not.toThrow();
	expect(() => assertReleaseVersion("999.0.0", versions)).toThrow("expected");
	expect(() => assertReleaseVersion(current, { ...versions, "Cargo.lock": "" })).toThrow(
		"Cargo.lock",
	);
	for (const version of ["", "01.0.0", "1.0.0\n", "1.0.0;echo bad"]) {
		expect(() => assertReleaseVersion(version, {})).toThrow();
	}
});
