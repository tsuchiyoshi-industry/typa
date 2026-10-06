import { expect, it } from "vitest";
import { toAuthEmail } from "./authEmail";

it("builds the same internal address for an employee number, with or without @ in the domain", () => {
	expect(toAuthEmail("TEST001", "@example.jp")).toBe("typa-test001@example.jp");
	expect(toAuthEmail("TEST001", "example.jp")).toBe("typa-test001@example.jp");
});
it.each(["", "a b", "a@b", "社員1", "a+b"])("rejects employee number %j", (employeeNo) => {
	expect(toAuthEmail(employeeNo, "@example.jp")).toBeNull();
});
it.each(["", "@"])("rejects a missing company domain %j", (domain) => {
	expect(toAuthEmail("TEST001", domain)).toBeNull();
});
