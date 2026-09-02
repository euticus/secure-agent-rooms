import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email delivery.
 *
 * Email leaves the platform's trust boundary, so what goes into a message is a
 * security decision, not a formatting one: notifications carry *what happened
 * and where to act*, never the payload that was proposed, disclosed, or
 * blocked. See templates.ts.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  readonly kind: string;
  send(message: EmailMessage): Promise<void>;
  /** Verify configuration at startup (best effort). */
  verify?(): Promise<boolean>;
}

/** Drops mail on the floor. Used when notifications are switched off. */
export class NoopEmailSender implements EmailSender {
  readonly kind = "noop";
  async send(): Promise<void> {}
}

/** Prints mail to the log — the default for local development. */
export class ConsoleEmailSender implements EmailSender {
  readonly kind = "console";
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(message: EmailMessage): Promise<void> {
    this.log(
      `\n--- email ---\nto: ${message.to}\nsubject: ${message.subject}\n\n${message.text}\n-------------\n`,
    );
  }
}

/** Collects mail in memory. Used by tests. */
export class MemoryEmailSender implements EmailSender {
  readonly kind = "memory";
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpEmailSender implements EmailSender {
  readonly kind = "smtp";
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }
}

export interface EmailConfig {
  enabled: boolean;
  from: string;
  /** Public base URL of the web app, used to build deep links. */
  appUrl: string;
}

/**
 * Build a sender from the environment.
 *
 * SMTP_HOST set  -> real SMTP delivery
 * BOOTH_EMAIL=console -> log messages (default in development)
 * otherwise      -> disabled
 */
export function createEmailSender(env: NodeJS.ProcessEnv = process.env): {
  sender: EmailSender;
  config: EmailConfig;
} {
  const from = env.EMAIL_FROM ?? "Secure Agent Rooms <no-reply@localhost>";
  const appUrl = (env.APP_URL ?? env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const mode = (env.BOOTH_EMAIL ?? "").toLowerCase();

  if (mode === "off" || mode === "none") {
    return { sender: new NoopEmailSender(), config: { enabled: false, from, appUrl } };
  }
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? 587);
    return {
      sender: new SmtpEmailSender({
        host: env.SMTP_HOST,
        port,
        // Implicit TLS on 465; STARTTLS is negotiated on other ports.
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from,
      }),
      config: { enabled: true, from, appUrl },
    };
  }
  if (mode === "console") {
    return { sender: new ConsoleEmailSender(), config: { enabled: true, from, appUrl } };
  }
  return { sender: new NoopEmailSender(), config: { enabled: false, from, appUrl } };
}

export * from "./templates.js";
