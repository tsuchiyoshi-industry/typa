// VITE_* is public renderer configuration, never a secret store.
export function assertPublicBuildEnvironment(env: Record<string, string>, csp: string): void {
	for (const [name, value] of Object.entries(env)) {
		if (value && /^VITE_.*(?:PASSWORD|PRIVATE_KEY|SERVICE_ROLE|SECRET|ACCESS_TOKEN)$/i.test(name)) {
			throw new Error(
				`Public frontend environment must not contain ${name}. Move credentials to a server.`,
			);
		}
	}
	const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
	if (key.startsWith("sb_secret_")) {
		throw new Error("Supabase secret key must not be included in the renderer.");
	}
	if (key.startsWith("eyJ")) {
		try {
			const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
			if (payload.role !== "anon") {
				throw new Error("Invalid public role");
			}
		} catch {
			throw new Error("Only a Supabase anon or publishable key is allowed in the renderer.");
		}
	}
	if (env.VITE_SUPABASE_URL) {
		const url = new URL(env.VITE_SUPABASE_URL);
		const sources =
			csp
				.split(";")
				.find((part) => part.trim().startsWith("connect-src "))
				?.trim()
				.split(/\s+/)
				.slice(1) ?? [];
		if (url.protocol !== "https:" || !sources.includes(url.origin)) {
			throw new Error(
				"Supabase URL must use HTTPS and match an explicit production CSP connect-src origin.",
			);
		}
	}
}
