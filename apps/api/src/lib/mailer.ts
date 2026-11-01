import nodemailer from 'nodemailer'
import type { Env } from '../env'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/** Resend over SMTP in production, plain SMTP (Mailpit) otherwise. */
export function createSmtpMailer(
  env: Pick<Env, 'MAIL_FROM' | 'SMTP_URL' | 'RESEND_API_KEY'>,
): Mailer {
  const transport = env.RESEND_API_KEY
    ? nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: { user: 'resend', pass: env.RESEND_API_KEY },
      })
    : nodemailer.createTransport(env.SMTP_URL)
  return {
    async send(message) {
      await transport.sendMail({ from: env.MAIL_FROM, ...message })
    },
  }
}

/** Collects messages in memory; used by tests. */
export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = []
  return {
    outbox,
    async send(message) {
      outbox.push(message)
    },
  }
}
