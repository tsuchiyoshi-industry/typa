import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

/** Databases that may be wiped and exposed. The application's own `postgres` DB never is. */
export const ISOLATED_DATABASES = ["typa_release_verify", "typa_release_fresh", "typa_e2e"];

const docker = (...args: string[]) => {
	const result = spawnSync("docker", args, { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`Docker operation failed: ${args[0]}`);
	}
	return result.stdout.trim();
};

export const isolatedSql = (database: string, statement: string) => {
	const result = spawnSync(
		"docker",
		[
			"exec",
			"-i",
			"supabase_db_typa",
			"psql",
			"-U",
			"postgres",
			"-d",
			database,
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-At",
		],
		{ input: statement, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error("Isolated fixture SQL failed");
	}
	return result.stdout.trim();
};

type Container = {
	Config: { Image: string; Env: string[] };
	NetworkSettings: { Networks: Record<string, unknown> };
};
const envOf = (template: Container) =>
	Object.fromEntries(
		template.Config.Env.map((item) => [
			item.slice(0, item.indexOf("=")),
			item.slice(item.indexOf("=") + 1),
		]),
	);

/**
 * Real GoTrue + PostgREST, connected only to an explicitly isolated DB, behind one
 * local URL (`base`) that supabase-js and the app can use as the Supabase URL.
 */
export async function startIsolatedApi(database: string) {
	if (!ISOLATED_DATABASES.includes(database)) {
		throw new Error("An isolated release database is required.");
	}
	const authTemplate = JSON.parse(docker("inspect", "supabase_auth_typa"))[0] as Container;
	const restTemplate = JSON.parse(docker("inspect", "supabase_rest_typa"))[0] as Container;
	const secret = envOf(authTemplate).GOTRUE_JWT_SECRET;
	if (!secret) {
		throw new Error("Local JWT signing configuration is required.");
	}
	const jwt = (role: string, sub?: string, claims: Record<string, unknown> = {}) => {
		const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
		const body = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ role, aud: "authenticated", sub, iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
		return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
	};
	const network = Object.keys(authTemplate.NetworkSettings.Networks)[0];
	const temp = resolve("supabase/.temp/release-check");
	mkdirSync(temp, { recursive: true });
	const names: string[] = [],
		files: string[] = [];
	const base = "http://127.0.0.1:56420";
	const proxy = createServer(async (request, response) => {
		// The hosted gateway answers CORS for the browser app (e2e); GoTrue alone does not.
		const origin = request.headers.origin;
		if (origin) {
			response.setHeader("Access-Control-Allow-Origin", origin);
			response.setHeader("Access-Control-Expose-Headers", "*");
		}
		if (origin && request.method === "OPTIONS") {
			response.writeHead(204, {
				"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
				"Access-Control-Allow-Headers": request.headers["access-control-request-headers"] ?? "*",
			});
			response.end();
			return;
		}
		try {
			const auth = request.url?.startsWith("/auth/v1");
			const path = (request.url ?? "/").replace(auth ? /^\/auth\/v1/ : /^\/rest\/v1/, "");
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				chunks.push(Buffer.from(chunk));
			}
			const body = Buffer.concat(chunks);
			const headers = new Headers();
			for (const [name, value] of Object.entries(request.headers)) {
				if (value && name !== "host" && name !== "content-length") {
					headers.set(name, Array.isArray(value) ? value.join(",") : value);
				}
			}
			if (auth) {
				// GoTrue's IP limiter requires a trusted gateway header. Never let a caller
				// choose that value (or the alternative Supabase forwarding header).
				headers.set("X-Forwarded-For", request.socket.remoteAddress ?? "127.0.0.1");
				headers.delete("Sb-Forwarded-For");
			}
			const result = await fetch(`http://127.0.0.1:${auth ? 56422 : 56421}${path}`, {
				method: request.method,
				headers,
				body: body.length ? body : undefined,
			});
			const outgoing = new Headers(result.headers);
			for (const name of ["content-length", "transfer-encoding", "content-encoding"]) {
				outgoing.delete(name);
			}
			if (origin) {
				outgoing.delete("access-control-allow-origin");
			}
			response.writeHead(result.status, Object.fromEntries(outgoing));
			response.end(Buffer.from(await result.arrayBuffer()));
		} catch {
			response.writeHead(502);
			response.end();
		}
	});
	const start = (
		template: Container,
		name: string,
		port: number,
		dbVariable: string,
		extra: Record<string, string> = {},
	) => {
		const env = envOf(template);
		const url = new URL(env[dbVariable]);
		url.pathname = `/${database}`;
		env[dbVariable] = url.href;
		Object.assign(env, extra);
		// Redirect all email into the existing local catcher (Mailpit), so nothing is
		// ever sent to an external SMTP server, even if templates change.
		if (dbVariable === "GOTRUE_DB_DATABASE_URL") {
			env.GOTRUE_SMTP_HOST = "supabase_inbucket_typa";
			env.GOTRUE_SMTP_PORT = "1025";
			env.GOTRUE_SMTP_USER = "";
			env.GOTRUE_SMTP_PASS = "";
		}
		const path = resolve(temp, `${name}.env`);
		files.push(path);
		writeFileSync(
			path,
			Object.entries(env)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n"),
		);
		docker(
			"run",
			"--detach",
			"--name",
			name,
			"--network",
			network,
			"--publish",
			`127.0.0.1:${port}:${port === 56421 ? 3000 : 9999}`,
			"--env-file",
			path,
			template.Config.Image,
		);
		names.push(name);
	};
	const stop = async () => {
		proxy.closeAllConnections();
		await new Promise<void>((resolve) => proxy.close(() => resolve()));
		for (const name of names.reverse()) {
			try {
				docker("rm", "--force", name);
			} catch {}
		}
		for (const file of files) {
			try {
				unlinkSync(file);
			} catch {}
		}
	};
	try {
		start(restTemplate, "typa_release_rest", 56421, "PGRST_DB_URI");
		start(authTemplate, "typa_release_auth", 56422, "GOTRUE_DB_DATABASE_URL", {
			GOTRUE_RATE_LIMIT_HEADER: "X-Forwarded-For",
			GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: "true",
			GOTRUE_HOOK_BEFORE_USER_CREATED_URI:
				"pg-functions://postgres/public/hook_before_user_created",
			GOTRUE_MAILER_AUTOCONFIRM: "true",
			API_EXTERNAL_URL: `${base}/auth/v1`,
		});
		await new Promise<void>((resolve) => proxy.listen(56420, "127.0.0.1", resolve));
		for (let i = 0; i < 60; i++) {
			if (
				await fetch(`${base}/auth/v1/health`)
					.then((r) => r.ok)
					.catch(() => false)
			) {
				break;
			}
			await new Promise((r) => setTimeout(r, 250));
			if (i === 59) {
				const logged = spawnSync("docker", ["logs", "typa_release_auth"], { encoding: "utf8" });
				const logs = (logged.stdout + logged.stderr)
					.replaceAll(secret, "[redacted]")
					.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/g, "$1[redacted]@");
				throw new Error(`Isolated Auth server did not start: ${logs.slice(-4000)}`);
			}
		}
	} catch (error) {
		await stop();
		throw error;
	}
	return {
		base,
		jwt,
		sql: (statement: string) => isolatedSql(database, statement),
		stop,
		network,
		images: { auth: authTemplate.Config.Image, rest: restTemplate.Config.Image },
		// 証跡に出せる設定だけを列挙する。SMTPやJWTの秘密は返さない。
		authSettings: Object.fromEntries(
			Object.entries({
				...envOf(authTemplate),
				GOTRUE_RATE_LIMIT_HEADER: "X-Forwarded-For",
			}).filter(([name]) =>
				/^GOTRUE_(RATE_LIMIT_|PASSWORD_MIN_LENGTH$|PASSWORD_REQUIRED_CHARACTERS$|SECURITY_CAPTCHA_ENABLED$|MFA_TOTP_(ENROLL|VERIFY)_ENABLED$)/.test(
					name,
				),
			),
		),
	};
}
