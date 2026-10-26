import { spawnSync } from "node:child_process";

export type DockerProbe = (args: string[]) => {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error & { code?: string };
};

const probeDocker: DockerProbe = (args) =>
	spawnSync("docker", args, { encoding: "utf8", timeout: 10_000, windowsHide: true });

/** 隔離DBを準備する前に、開発用プラットフォームの稼働だけを確認する。 */
export function assertLocalSupabaseReady(probe: DockerProbe = probeDocker): void {
	const daemon = probe(["info", "--format", "{{.ServerVersion}}"]);
	if (daemon.error?.code === "ENOENT") {
		throw new Error(
			"Docker CLI が見つかりません。Docker Desktop をインストールし、ターミナルを開き直してください。",
		);
	}
	if (daemon.status !== 0) {
		throw new Error(
			"Docker に接続できません。Docker Desktop を起動し、起動完了後にもう一度実行してください（docker desktop start）。",
		);
	}
	for (const container of [
		"supabase_db_typa",
		"supabase_auth_typa",
		"supabase_rest_typa",
		"supabase_inbucket_typa",
	]) {
		const state = probe(["inspect", "--format", "{{.State.Running}}", container]);
		if (state.status !== 0 || state.stdout.trim() !== "true") {
			throw new Error(
				`ローカル Supabase の ${container} が起動していません。プロジェクトのルートで bunx supabase@2.121.0 start を実行してから、もう一度実行してください。`,
			);
		}
	}
	if (
		probe(["exec", "supabase_db_typa", "pg_isready", "-U", "postgres", "-d", "postgres"]).status !==
		0
	) {
		throw new Error(
			"ローカル PostgreSQL の起動が完了していません。Docker Desktop の起動後、少し待ってからもう一度実行してください。",
		);
	}
}
