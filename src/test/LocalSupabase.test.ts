import { expect, it, vi } from "vitest";
import { assertLocalSupabaseReady, type DockerProbe } from "../../scripts/localSupabase";

const ready = () => vi.fn<DockerProbe>().mockReturnValue({ status: 0, stdout: "true", stderr: "" });

it("explains how to start Docker Desktop when the daemon is unavailable", () => {
	const probe = ready().mockReturnValueOnce({
		status: 1,
		stdout: "",
		stderr: "cannot connect to docker API",
	});
	expect(() => assertLocalSupabaseReady(probe)).toThrow("Docker Desktop");
	expect(probe).toHaveBeenCalledTimes(1);
});

it("identifies a missing Docker CLI", () => {
	const probe = ready().mockReturnValueOnce({
		status: null,
		stdout: "",
		stderr: "",
		error: Object.assign(new Error("not found"), { code: "ENOENT" }),
	});
	expect(() => assertLocalSupabaseReady(probe)).toThrow("Docker CLI");
});

it.each(["supabase_db_typa", "supabase_auth_typa", "supabase_rest_typa", "supabase_inbucket_typa"])(
	"identifies the stopped local container %s and its startup command",
	(container) => {
		const probe = ready().mockImplementation((args) => ({
			status: 0,
			stdout: args.includes(container) ? "false" : "true",
			stderr: "",
		}));
		expect(() => assertLocalSupabaseReady(probe)).toThrow(container);
		expect(() => assertLocalSupabaseReady(probe)).toThrow("supabase@2.121.0 start");
	},
);

it("reports a database that is still starting before any fixture preparation", () => {
	const probe = ready().mockImplementation((args) => ({
		status: args.includes("pg_isready") ? 1 : 0,
		stdout: "true",
		stderr: "",
	}));
	expect(() => assertLocalSupabaseReady(probe)).toThrow("PostgreSQL の起動が完了");
});

it("accepts the running local platform without reading secrets or altering its database", () => {
	const probe = ready();
	expect(() => assertLocalSupabaseReady(probe)).not.toThrow();
	expect(
		probe.mock.calls.every(
			([args]) => args[0] === "info" || args[0] === "inspect" || args.includes("pg_isready"),
		),
	).toBe(true);
	expect(probe.mock.calls.some(([args]) => args.includes(".Config.Env"))).toBe(false);
});
