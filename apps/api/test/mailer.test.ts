import nodemailer from 'nodemailer'
import { afterEach, expect, it, vi } from 'vitest'
import { createSmtpMailer } from '../src/lib/mailer'

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it.each([false, true])(
  'delivers using the configured SMTP credentials (Resend: %s)',
  async (resend) => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'delivered' })
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as unknown as ReturnType<
      typeof nodemailer.createTransport
    >)
    const mailer = createSmtpMailer({
      MAIL_FROM: 'sender@example.test',
      SMTP_URL: 'smtp://localhost:1025',
      RESEND_API_KEY: resend ? 'api-key' : undefined,
    })
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      resend
        ? {
            host: 'smtp.resend.com',
            port: 465,
            secure: true,
            auth: { user: 'resend', pass: 'api-key' },
          }
        : 'smtp://localhost:1025',
    )
    const message = {
      to: 'recipient@example.test',
      subject: 'Reset your password',
      text: 'Reset link',
      html: '<a>Reset link</a>',
    }
    await mailer.send(message)
    expect(sendMail).toHaveBeenCalledWith({ from: 'sender@example.test', ...message })
    sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'))
    await expect(mailer.send(message)).rejects.toThrow('SMTP unavailable')
  },
)
