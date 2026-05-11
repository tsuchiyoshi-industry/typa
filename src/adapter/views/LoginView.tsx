import { createSignal, Show } from "solid-js";
import { supabase } from "../../infrastructure/db/supabase";

const LoginView = () => {
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [loading, setLoading] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	const handleLogin = async (event: Event) => {
		event.preventDefault();
		setLoading(true);
		setErrorMessage(null);

		const { error } = await supabase.auth.signInWithPassword({
			email: email(),
			password: password(),
		});

		if (error) {
			setErrorMessage(error.message);
		}
		setLoading(false);
	};

	return (
		<div class="login-cover">
			<div class="auth-card">
				<h2>ログイン</h2>
				<form class="login-form" onSubmit={handleLogin}>
					<div class="login-fieldset">
						<label for="email">Email</label>
						<input
							id="email"
							type="email"
							placeholder="Email"
							onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
						/>
					</div>
					<div class="login-fieldset">
						<label for="password">Password</label>
						<input
							id="password"
							type="password"
							placeholder="Password"
							onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
						/>
					</div>
					<Show when={errorMessage()}>
						<p class="error-message">{errorMessage()}</p>
					</Show>
					<button type="submit" disabled={loading()}>
						{loading() ? "Loading..." : "Login"}
					</button>
				</form>
			</div>
		</div>
	);
};

export default LoginView;
