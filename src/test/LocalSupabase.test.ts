import { expect, it, vi } from "vitest";
import { assertLocalSupabaseReady, type DockerProbe } from "../../scripts/localSupabase";

const ok = { status: 0, stdout: "true", stderr: "" };
const ready = () => vi.fn<DockerProbe>().mockReturnValue(ok);
const unreachable = {
	status: 1,
	stdout: "",
	stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
};

// 本番 CI(ubuntu)では supabase start が成功した直後でも `docker info` が 0 以外で終わり、
// 動いている環境を「Docker に接続できません」と止めていた。Docker への到達確認は、
// コンテナが見つからないときに理由を説明するためだけに使う。
it("does not block a running platform even when Docker's daemon summary fails", () => {
	const probe = ready().mockImplementation((args) =>
		args[0] === "info" || args[0] === "version" ? unreachable : ok,
	);
	expect(() => assertLocalSupabaseReady(probe)).not.toThrow();
});

it("explains how to start Docker, with Docker's own message, when the daemon is unavailable", () => {
	const probe = ready().mockReturnValue(unreachable);
	expect(() => assertLocalSupabaseReady(probe)).toThrow("Docker に接続できません");
	expect(() => assertLocalSupabaseReady(probe)).toThrow("Cannot connect to the Docker daemon");
});

it("identifies a missing Docker CLI", () => {
	const probe = ready().mockReturnValue({
		status: null,
		stdout: "",
		stderr: "",
		error: Object.assign(new Error("not found"), { code: "ENOENT" }),
	});
	expect(() => assertLocalSupabaseReady(probe)).toThrow("Docker CLI");
});

it("reports a probe that timed out or was killed instead of calling it a stopped daemon", () => {
	const probe = ready().mockReturnValue({
		status: null,
		stdout: "",
		stderr: "",
		error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" }),
	});
	expect(() => assertLocalSupabaseReady(probe)).toThrow("ETIMEDOUT");
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

it("identifies a container that does not exist while Docker itself answers", () => {
	const probe = ready().mockImplementation((args) =>
		args.includes("supabase_rest_typa")
			? { status: 1, stdout: "", stderr: "Error: No such object: supabase_rest_typa" }
			: ok,
	);
	expect(() => assertLocalSupabaseReady(probe)).toThrow("supabase_rest_typa が起動していません");
	expect(() => assertLocalSupabaseReady(probe)).toThrow("No such object");
});

it("reports a database that is still starting before any fixture preparation", () => {
	const probe = ready().mockImplementation((args) =>
		args.includes("pg_isready")
			? { status: 1, stdout: "/var/run/postgresql:5432 - rejecting connections", stderr: "" }
			: ok,
	);
	expect(() => assertLocalSupabaseReady(probe)).toThrow("PostgreSQL の起動が完了");
	expect(() => assertLocalSupabaseReady(probe)).toThrow("rejecting connections");
});

it("accepts the running local platform without reading secrets or altering its database", () => {
	const probe = ready();
	expect(() => assertLocalSupabaseReady(probe)).not.toThrow();
	expect(
		probe.mock.calls.every(([args]) => args[0] === "inspect" || args.includes("pg_isready")),
	).toBe(true);
	expect(probe.mock.calls.some(([args]) => args.includes(".Config.Env"))).toBe(false);
});
