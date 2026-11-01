import type { MailMessage } from './mailer'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export function loginCodeEmail(to: string, code: string): MailMessage {
  return {
    to,
    subject: 'Your QuoteDB sign-in code',
    text: `Your QuoteDB sign-in code is: ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this email. Never share this code.`,
  }
}

export function inviteEmail(to: string, name: string, link: string): MailMessage {
  return {
    to,
    subject: "You've been invited to QuoteDB",
    text: `Hi ${name},\n\nYour QuoteDB account is ready. Sign in with an email code:\n\n${link}\n`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your QuoteDB account is ready.</p><p><a href="${escapeHtml(link)}">Sign in with an email code</a></p>`,
  }
}

export function emailChangedEmail(to: string): MailMessage {
  return {
    to,
    subject: 'Your QuoteDB sign-in email changed',
    text: 'An administrator changed your QuoteDB sign-in email. Existing web sessions have been signed out. If you did not request this change, contact your QuoteDB administrator.',
  }
}
