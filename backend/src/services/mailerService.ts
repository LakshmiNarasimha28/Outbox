import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface SendMailOptions {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export interface SendMailResult {
  messageId: string;
  previewUrl: string | null;
}

export class MailerService {
  private static transporter: Transporter | null = null;

  /**
   * Checks whether SMTP credentials (user and password) are configured in the environment.
   */
  public static isConfigured(): boolean {
    return Boolean(env.SMTP_USER && env.SMTP_PASS);
  }

  /**
   * Gets or initializes the cached Nodemailer transporter.
   */
  public static getTransporter(): Transporter {
    if (!this.isConfigured()) {
      throw new Error(
        'Ethereal SMTP credentials are not configured. Please define SMTP_USER and SMTP_PASS in backend/.env.'
      );
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    }

    return this.transporter;
  }

  /**
   * Sends an email via Nodemailer and captures the Ethereal preview URL.
   * If credentials are missing, throws an informative error without pretending an email was sent.
   */
  public static async sendMail(options: SendMailOptions): Promise<SendMailResult> {
    if (!this.isConfigured()) {
      throw new Error(
        'Ethereal SMTP credentials missing (SMTP_USER / SMTP_PASS not set in backend/.env). Cannot dispatch email.'
      );
    }

    const transporter = this.getTransporter();
    const fromAddress = options.from || env.DEFAULT_SENDER;

    const info = await transporter.sendMail({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: `<div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #4f46e5;">${escapeHtml(options.subject)}</h2>
        <div style="white-space: pre-wrap; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
          ${escapeHtml(options.body)}
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 16px;">
          Sent by Outbox Labs Email Job Scheduler via Ethereal SMTP
        </p>
      </div>`,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return {
      messageId: info.messageId,
      previewUrl: previewUrl ? previewUrl.toString() : null,
    };
  }

  /**
   * Generates a new Ethereal test account on ethereal.email.
   * Useful for development setup and testing.
   */
  public static async createEtherealTestAccount() {
    return nodemailer.createTestAccount();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
