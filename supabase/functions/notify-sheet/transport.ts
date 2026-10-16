import nodemailer from "nodemailer";
import type { SmtpSettings } from "./handler.ts";

export function createNotificationTransport(smtp: SmtpSettings, ca?: string) {
	return nodemailer.createTransport({
		host: smtp.smtp_host,
		port: smtp.smtp_port,
		secure: smtp.smtp_port === 465,
		requireTLS: true,
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		disableFileAccess: true,
		disableUrlAccess: true,
		auth: { user: smtp.smtp_user, pass: smtp.smtp_password },
		...(ca ? { tls: { ca } } : {}),
	});
}
