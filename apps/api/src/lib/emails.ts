import type { MailMessage } from './mailer'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function passwordResetEmail(to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: 'Reset your QuoteDB password',
    text: `Hi ${name},\n\nSomeone asked to reset your QuoteDB password. If that was you, open this link within an hour:\n\n${link}\n\nIf it wasn't you, ignore this email; your password stays the same.\n`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset your QuoteDB password. If that was you, open this link within an hour:</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If it wasn't you, ignore this email; your password stays the same.</p>`,
  }
}

export function inviteEmail(to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: "You've been invited to QuoteDB",
    text: `Hi ${name},\n\nAn account has been created for you on QuoteDB. Choose a password within 7 days:\n\n${link}\n`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>An account has been created for you on QuoteDB. Choose a password within 7 days:</p><p><a href="${escapeHtml(link)}">Set your password</a></p>`,
  }
}
