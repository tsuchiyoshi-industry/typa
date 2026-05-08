import { type Component, createSignal } from "solid-js";
import { supabase } from "../../utils/supabase";

const Login: Component = () => {
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [loading, setLoading] = createSignal(false);

	const handleLogin = async (e: SubmitEvent) => {
		e.preventDefault();
		setLoading(true);
		const { error } = await supabase.auth.signInWithPassword({
			email: email(),
			password: password(),
		});

		if (error) {
			alert(error.message);
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
							onInput={(e) => setEmail(e.currentTarget.value)}
						/>
					</div>
					<div class="login-fieldset">
						<label for="password">Password</label>
						<input
							id="password"
							type="password"
							placeholder="Password"
							onInput={(e) => setPassword(e.currentTarget.value)}
						/>
					</div>
					<button type="submit" disabled={loading()}>
						{loading() ? "Loading..." : "Login"}
					</button>
				</form>
			</div>
		</div>
	);
};

export default Login;
