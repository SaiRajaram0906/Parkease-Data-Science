import { logger } from "./logger";

/**
 * Sends email through an SMTP account set in backend/.env:
 *
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=your-app-password
 *   # optional: SMTP_HOST, SMTP_PORT, SMTP_SECURE, MAIL_FROM
 *
 * With a Gmail address only SMTP_USER and SMTP_PASS are needed (the password
 * must be a Google "app password", not the normal account password).
 * Without these settings nothing is sent; the message is still saved and
 * shown in the app, marked "email not set up".
 */
export type MailStatus = "sent" | "not_configured" | "skipped_demo" | "failed";
export interface MailResult {
  status: MailStatus;
  error?: string;
}

const env = (name: string): string => (process.env[name] ?? "").trim();

export function mailSettings() {
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS").replace(/\s+/g, ""); // app passwords are shown with spaces
  const gmail = /@(gmail|googlemail)\.com$/i.test(user);
  const host = env("SMTP_HOST") || (gmail ? "smtp.gmail.com" : "");
  const port = Number(env("SMTP_PORT")) || (gmail ? 465 : 587);
  const secureSetting = env("SMTP_SECURE").toLowerCase();
  const secure = secureSetting ? secureSetting === "true" : port === 465;
  const from = env("MAIL_FROM") || (user ? `ParkEase <${user}>` : "ParkEase <no-reply@parkease.local>");
  // A local test server may accept mail without a login, so only the host is required.
  return { configured: Boolean(host), host, port, secure, user, pass, from };
}

/**
 * Demo accounts never get real email. Their addresses are made up for the
 * demo, so a message sent to one could reach a stranger.
 */
const DEMO_ADDRESSES = new Set(["priya.sharma@gmail.com", "rajesh.kumar@gmail.com", "vikram.nair@gmail.com"]);
const isDemoAddress = (email: string): boolean =>
  /@demo\.parkease\.in$/i.test(email) || DEMO_ADDRESSES.has(email.toLowerCase());

let transport: { key: string; send: (message: Record<string, unknown>) => Promise<unknown> } | null = null;

export async function sendMail(message: { to: string; subject: string; text: string; html?: string }): Promise<MailResult> {
  const settings = mailSettings();
  if (!message.to || isDemoAddress(message.to)) return { status: "skipped_demo" };
  if (!settings.configured) return { status: "not_configured" };

  try {
    const key = JSON.stringify(settings);
    if (!transport || transport.key !== key) {
      // Loaded on first use so the server still starts if the package is missing.
      const nodemailer = (await import("nodemailer")).default;
      const created = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      });
      transport = { key, send: (m) => created.sendMail(m) };
    }
    await transport.send({ from: settings.from, ...message });
    return { status: "sent" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: message.to }, "Email could not be sent");
    const missing = /Cannot find (package|module)/i.test(error);
    return { status: "failed", error: missing ? "The nodemailer package is not installed. Run: pnpm install" : error };
  }
}
