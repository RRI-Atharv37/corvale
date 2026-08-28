import nodemailer from 'nodemailer'
import { passwordResetEmailHtml, emailVerificationEmailHtml } from './emailTemplates'

export interface MailMessage {
    to: string
    subject: string
    html: string
    text?: string
}

export interface MailTransport {
    sendMail(message: MailMessage): Promise<{ messageId: string }>
}

let testTransport: MailTransport | null = null

/** Test-only hook to inject a fake transport without a live SMTP connection. */
export const setMailTransport = (transport: MailTransport | null): void => {
    testTransport = transport
}

export const isSmtpConfigured = (): boolean => Boolean(process.env.SMTP_HOST)

const buildNodemailerTransport = (): MailTransport => {
    const port = Number(process.env.SMTP_PORT ?? 587)
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    })

    return {
        sendMail: async (message: MailMessage) => {
            const info = await transporter.sendMail({
                // V9: sending domain send.corvale.app has SPF + DKIM + DMARC published, so this
                // From address authenticates and aligns. Override per-deployment with SMTP_FROM;
                // if you change the domain here, publish its DNS records first or reset mail gets
                // spam-foldered / hard-rejected.
                from: process.env.SMTP_FROM ?? 'Corvale <no-reply@send.corvale.app>',
                // These are no-reply mailboxes; point human replies at a real inbox instead.
                replyTo: process.env.SMTP_REPLY_TO ?? 'Corvale Support <support@corvale.app>',
                ...message,
            })
            return { messageId: info.messageId }
        },
    }
}

const getTransport = (): MailTransport => testTransport ?? buildNodemailerTransport()

export const sendPasswordResetEmail = async (email: string, resetUrl: string): Promise<void> => {
    const expiryMs = Number(process.env.PASSWORD_RESET_EXPIRY_MS ?? 600_000)

    await getTransport().sendMail({
        to: email,
        subject: 'Reset your Corvale password',
        html: passwordResetEmailHtml(resetUrl, expiryMs),
        text: `Reset your Corvale password: ${resetUrl}`,
    })
}

export const sendEmailVerificationEmail = async (email: string, verifyUrl: string): Promise<void> => {
    const expiryMs = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MS ?? 600_000)

    await getTransport().sendMail({
        to: email,
        subject: 'Verify your Corvale email address',
        html: emailVerificationEmailHtml(verifyUrl, expiryMs),
        text: `Verify your Corvale email address: ${verifyUrl}`,
    })
}
