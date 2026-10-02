import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { emailBrandingSchema, type BrandingSettings } from '@opencred/schema';
import { renderMergeString, type MergeContext } from '@opencred/schema';
import { loadConfig } from '../../config';
import { CryptoService } from '../../common/crypto.service';
import { escapeHtml } from '@opencred/renderer';

/**
 * Email delivery.
 *
 * FR-ISS-07 is the requirement that shapes this file: an organisation must be
 * able to send from its own domain through its own provider. That is not a
 * nice-to-have. Credential emails are transactional mail that recipients are
 * primed to distrust ("you have received a certificate, click here"), and
 * sending them from a shared platform domain means one careless tenant's
 * reputation becomes every tenant's spam folder.
 *
 * So: a platform-level transport for system mail (verification, password
 * reset) and a per-organisation transport, resolved and cached per org, for
 * everything a recipient sees.
 */

export interface SystemEmail {
  to: string;
  subject: string;
  heading: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
}

export interface OrgSmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  /** Encrypted at rest; decrypted only here, at send time. */
  passwordEncrypted?: string;
  from: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly config = loadConfig();
  private platformTransport: Transporter | null = null;
  private readonly orgTransports = new Map<string, { transport: Transporter; from: string }>();

  constructor(private readonly crypto: CryptoService) {}

  private getPlatformTransport(): Transporter {
    if (this.platformTransport) return this.platformTransport;

    if (this.config.MAIL_TRANSPORT === 'log') {
      // `jsonTransport` produces the full message without sending it, which is
      // what makes a fresh clone runnable with no mail server at all.
      this.platformTransport = nodemailer.createTransport({ jsonTransport: true });
    } else {
      this.platformTransport = nodemailer.createTransport({
        host: this.config.MAIL_HOST,
        port: this.config.MAIL_PORT,
        secure: this.config.MAIL_SECURE,
        ...(this.config.MAIL_USER
          ? { auth: { user: this.config.MAIL_USER, pass: this.config.MAIL_PASSWORD } }
          : {}),
      });
    }
    return this.platformTransport;
  }

  private resolveOrgTransport(
    organizationId: string,
    settings: OrgSmtpSettings | null,
  ): { transport: Transporter; from: string } {
    if (!settings?.enabled || !settings.host) {
      return { transport: this.getPlatformTransport(), from: this.config.MAIL_FROM };
    }

    const cached = this.orgTransports.get(organizationId);
    if (cached) return cached;

    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      ...(settings.user && settings.passwordEncrypted
        ? {
            auth: {
              user: settings.user,
              pass: this.crypto.decrypt(settings.passwordEncrypted),
            },
          }
        : {}),
    });

    const entry = { transport, from: settings.from || this.config.MAIL_FROM };
    this.orgTransports.set(organizationId, entry);
    return entry;
  }

  /** Drop a cached transport after an org changes its SMTP settings. */
  invalidateOrgTransport(organizationId: string): void {
    this.orgTransports.delete(organizationId);
  }

  async verifyOrgSmtp(settings: OrgSmtpSettings): Promise<{ ok: boolean; error?: string }> {
    try {
      const transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        ...(settings.user && settings.passwordEncrypted
          ? { auth: { user: settings.user, pass: this.crypto.decrypt(settings.passwordEncrypted) } }
          : {}),
        connectionTimeout: 10_000,
      });
      await transport.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async sendSystemEmail(email: SystemEmail): Promise<void> {
    const html = systemEmailHtml(email);
    const info = await this.getPlatformTransport().sendMail({
      from: this.config.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: `${email.heading}\n\n${email.body}${email.actionUrl ? `\n\n${email.actionUrl}` : ''}`,
      html,
    });

    if (this.config.MAIL_TRANSPORT === 'log') {
      this.logger.log(
        `[mail:log] to=${email.to} subject="${email.subject}"` +
          (email.actionUrl ? ` action=${email.actionUrl}` : ''),
      );
    } else {
      this.logger.debug(`sent system email to ${email.to} (${info.messageId})`);
    }
  }

  /**
   * FR-DEL-01 — the branded credential delivery email.
   *
   * Rendered as table-based HTML with inline styles because that is what Gmail,
   * Outlook desktop and Apple Mail all render consistently; modern CSS layout
   * silently collapses in Outlook's Word rendering engine. A plain-text part is
   * always included, which matters both for accessibility and for spam scoring.
   */
  async sendCredentialEmail(params: {
    organizationId: string;
    smtp: OrgSmtpSettings | null;
    branding: BrandingSettings;
    to: string;
    context: MergeContext;
    verificationUrl: string;
    downloadUrl: string;
    linkedInUrl: string;
    walletUrl: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
    trackingPixelUrl?: string;
  }): Promise<{ messageId: string }> {
    const { transport, from } = this.resolveOrgTransport(params.organizationId, params.smtp);
    const emailBranding = emailBrandingSchema.parse(params.branding.email ?? {});

    const subject = renderMergeString(emailBranding.subjectTemplate, params.context);
    const intro = renderMergeString(emailBranding.bodyIntro, params.context);
    const issuerName = String(params.context['issuer.name'] ?? 'Your issuer');
    const credentialTitle = String(params.context['credential.title'] ?? 'Your credential');

    const html = credentialEmailHtml({
      issuerName,
      credentialTitle,
      intro,
      accentColor: emailBranding.accentColor,
      headerImage: emailBranding.headerImage,
      footerText: emailBranding.footerText,
      verificationUrl: params.verificationUrl,
      downloadUrl: params.downloadUrl,
      linkedInUrl: params.linkedInUrl,
      walletUrl: params.walletUrl,
      whiteLabel: params.branding.whiteLabel,
      trackingPixelUrl: params.trackingPixelUrl,
    });

    const text = [
      intro,
      '',
      `Credential: ${credentialTitle}`,
      `Issued by: ${issuerName}`,
      '',
      `Download: ${params.downloadUrl}`,
      `Verify:   ${params.verificationUrl}`,
      `Add to LinkedIn: ${params.linkedInUrl}`,
      '',
      params.branding.whiteLabel ? '' : 'Issued with OpenCred.',
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    const info = await transport.sendMail({
      from: emailBranding.fromName ? `${emailBranding.fromName} <${extractAddress(from)}>` : from,
      to: params.to,
      ...(emailBranding.replyTo ? { replyTo: emailBranding.replyTo } : {}),
      subject,
      text,
      html,
      ...(params.attachments && params.attachments.length > 0
        ? { attachments: params.attachments }
        : {}),
    });

    return { messageId: info.messageId ?? '' };
  }
}

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

function systemEmailHtml(email: SystemEmail): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:${FONT_STACK}">
<tr><td style="font-size:20px;font-weight:600;color:#111827;padding-bottom:12px">${escapeHtml(email.heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#374151;padding-bottom:24px">${escapeHtml(email.body)}</td></tr>
${
  email.actionUrl
    ? `<tr><td style="padding-bottom:24px"><a href="${escapeHtml(email.actionUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600">${escapeHtml(email.actionLabel ?? 'Continue')}</a></td></tr>
<tr><td style="font-size:12px;color:#6b7280;line-height:1.5;word-break:break-all">If the button does not work, paste this into your browser:<br>${escapeHtml(email.actionUrl)}</td></tr>`
    : ''
}
</table></td></tr></table></body></html>`;
}

function credentialEmailHtml(p: {
  issuerName: string;
  credentialTitle: string;
  intro: string;
  accentColor: string;
  headerImage: string | null;
  footerText: string | null;
  verificationUrl: string;
  downloadUrl: string;
  linkedInUrl: string;
  walletUrl: string;
  whiteLabel: boolean;
  trackingPixelUrl?: string;
}): string {
  const accent = escapeHtml(p.accentColor);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(p.credentialTitle)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(p.credentialTitle)} from ${escapeHtml(p.issuerName)} — download, verify or share it.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:${FONT_STACK}">
${
  p.headerImage
    ? `<tr><td><img src="${escapeHtml(p.headerImage)}" alt="${escapeHtml(p.issuerName)}" width="600" style="display:block;width:100%;max-width:600px;height:auto"></td></tr>`
    : `<tr><td style="background:${accent};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>`
}
<tr><td style="padding:32px 32px 8px">
  <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6b7280">${escapeHtml(p.issuerName)}</div>
  <div style="font-size:24px;font-weight:700;color:#111827;padding-top:6px;line-height:1.3">${escapeHtml(p.credentialTitle)}</div>
</td></tr>
<tr><td style="padding:12px 32px 24px;font-size:15px;line-height:1.65;color:#374151">${escapeHtml(p.intro)}</td></tr>
<tr><td style="padding:0 32px 8px">
  <a href="${escapeHtml(p.downloadUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:8px;font-size:15px;font-weight:600">Download your credential</a>
</td></tr>
<tr><td style="padding:14px 32px 28px;font-size:14px;line-height:2">
  <a href="${escapeHtml(p.verificationUrl)}" style="color:${accent};text-decoration:none">View the public verification page</a><br>
  <a href="${escapeHtml(p.linkedInUrl)}" style="color:${accent};text-decoration:none">Add to your LinkedIn profile</a><br>
  <a href="${escapeHtml(p.walletUrl)}" style="color:${accent};text-decoration:none">See all your credentials</a>
</td></tr>
<tr><td style="padding:0 32px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px">
    <tr><td style="padding:16px;font-size:13px;color:#4b5563;line-height:1.6">
      This credential is cryptographically signed. Anyone can confirm it is genuine at the verification link above — no account required.
    </td></tr>
  </table>
</td></tr>
${
  p.footerText
    ? `<tr><td style="padding:0 32px 20px;font-size:12px;color:#6b7280;line-height:1.6">${escapeHtml(p.footerText)}</td></tr>`
    : ''
}
${
  p.whiteLabel
    ? ''
    : `<tr><td style="padding:0 32px 28px;font-size:12px;color:#9ca3af">Issued with OpenCred, the open-source credentialing platform.</td></tr>`
}
</table></td></tr></table>
${p.trackingPixelUrl ? `<img src="${escapeHtml(p.trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}
</body></html>`;
}
