import assert from "node:assert/strict";
import { createServer as netServer, type Socket } from "node:net";
import { createSecureContext, TLSSocket, createServer as tlsServer } from "node:tls";
import { createNotificationTransport } from "./transport.ts";

// Synthetic certificates are generated for loopback only, never committed or used
// by the production handler. Test both implicit TLS (465) and mandatory STARTTLS.
async function smtpFixture(implicit: boolean, startTls: boolean) {
	const dir = await Deno.makeTempDir({ prefix: "typa-smtp-test-" });
	const openssl = Deno.env.get("OPENSSL_BIN") ?? "openssl";
	const generated = await new Deno.Command(openssl, {
		args: [
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"1",
			"-keyout",
			`${dir}/key.pem`,
			"-out",
			`${dir}/cert.pem`,
			"-subj",
			"/CN=localhost",
			"-addext",
			"subjectAltName=DNS:localhost,IP:127.0.0.1",
		],
		stdout: "null",
		stderr: "piped",
	}).output();
	assert.equal(generated.success, true, "Could not generate a loopback TLS certificate");
	const key = await Deno.readTextFile(`${dir}/key.pem`),
		cert = await Deno.readTextFile(`${dir}/cert.pem`);
	const sockets = new Set<Socket>();
	const authentication: string[] = [];
	let delivered = false;
	function attach(socket: Socket, encrypted: boolean, greet: boolean) {
		sockets.add(socket);
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
		if (greet) {
			socket.write("220 localhost release test\r\n");
		}
		let buffer = "",
			data = false;
		function receive(chunk: Uint8Array) {
			buffer += Buffer.from(chunk).toString();
			while (buffer.includes("\r\n")) {
				const end = buffer.indexOf("\r\n"),
					line = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				if (data) {
					if (line === ".") {
						data = false;
						delivered = true;
						socket.write("250 accepted\r\n");
					}
					continue;
				}
				if (/^EHLO|^HELO/.test(line)) {
					socket.write(
						`250-localhost\r\n${!encrypted && startTls ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`,
					);
				} else if (line === "STARTTLS" && startTls) {
					socket.off("data", receive);
					socket.write("220 upgrade\r\n");
					const secure = new TLSSocket(socket, {
						isServer: true,
						secureContext: createSecureContext({ key, cert }),
					});
					attach(secure, true, false);
					return;
				} else if (line.startsWith("AUTH PLAIN ")) {
					assert.equal(encrypted, true, "Credentials were sent without TLS");
					authentication.push(Buffer.from(line.slice(11), "base64").toString());
					socket.write("235 authenticated\r\n");
				} else if (/^MAIL FROM:|^RCPT TO:/.test(line)) {
					socket.write("250 ok\r\n");
				} else if (line === "DATA") {
					data = true;
					socket.write("354 data\r\n");
				} else if (line === "QUIT") {
					socket.end("221 bye\r\n");
				} else {
					socket.write("500 unsupported\r\n");
				}
			}
		}
		socket.on("data", receive);
	}
	const server = implicit
		? tlsServer({ key, cert }, (socket) => attach(socket, true, true))
		: netServer((socket) => attach(socket, false, true));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(implicit ? 465 : 0, "127.0.0.1", resolve);
	});
	const port = (server.address() as { port: number }).port;
	return {
		cert,
		port,
		authentication,
		delivered: () => delivered,
		async close() {
			for (const socket of sockets) {
				socket.destroy();
			}
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await Deno.remove(`${dir}/key.pem`);
			await Deno.remove(`${dir}/cert.pem`);
			await Deno.remove(dir);
		},
	};
}

for (const implicit of [true, false]) {
	Deno.test(`SMTP delivers over ${implicit ? "implicit TLS on port 465" : "STARTTLS"}`, async () => {
		const server = await smtpFixture(implicit, true);
		const transport = createNotificationTransport(
			{
				smtp_host: "127.0.0.1",
				smtp_port: server.port,
				smtp_user: "sender@example.test",
				smtp_password: "synthetic-password",
			},
			server.cert,
		);
		try {
			await transport.sendMail({
				from: "sender@example.test",
				to: "recipient@example.test",
				subject: "Release check",
				text: "Synthetic mail only.",
			});
			assert.equal(server.delivered(), true);
			assert.deepEqual(server.authentication, ["\0sender@example.test\0synthetic-password"]);
		} finally {
			transport.close();
			await server.close();
		}
	});
}

Deno.test("SMTP refuses a server that cannot encrypt; no credentials or message are sent", async () => {
	const server = await smtpFixture(false, false);
	const transport = createNotificationTransport(
		{
			smtp_host: "127.0.0.1",
			smtp_port: server.port,
			smtp_user: "sender@example.test",
			smtp_password: "synthetic-password",
		},
		server.cert,
	);
	try {
		await assert.rejects(
			transport.sendMail({
				from: "sender@example.test",
				to: "recipient@example.test",
				subject: "Release check",
				text: "Must not send",
			}),
		);
		assert.equal(server.delivered(), false);
		assert.deepEqual(server.authentication, []);
	} finally {
		transport.close();
		await server.close();
	}
});
