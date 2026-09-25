import nodemailer from 'nodemailer'
import type { DunningStage } from '@core/billing/dunning'
import type { LifecycleEmailStage } from '@core/billing/lifecycleEmail'
import type { RetentionStage } from '@core/billing/retention'
import {
    passwordResetEmailHtml,
    emailVerificationEmailHtml,
    dunningEmailContent,
    retentionEmailContent,
    lifecycleEmailContent,
    type LifecycleEmailInput,
    adminSecurityNoticeContent,
    type AdminSecurityEvent,
} from './emailTemplates'

export interface MailMessage {
    to: string
    subject: string
    html: string
    text?: string
    headers?: Record<string, string>
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

export const sendDunningEmail = async (
    email: string,
    content: { stage: DunningStage; graceEndsAt: Date; billingUrl: string }
): Promise<void> => {
    const { subject, html, text } = dunningEmailContent(content.stage, content.graceEndsAt, content.billingUrl)

    await getTransport().sendMail({ to: email, subject, html, text })
}

export const sendRetentionEmail = async (
    email: string,
    content: { stage: RetentionStage; deletionDate: Date; billingUrl: string }
): Promise<void> => {
    const { subject, html, text } = retentionEmailContent(content.stage, content.deletionDate, content.billingUrl)

    await getTransport().sendMail({ to: email, subject, html, text })
}

export const sendLifecycleEmail = async (email: string, content: { stage: LifecycleEmailStage } & LifecycleEmailInput): Promise<void> => {
    const { stage, ...input } = content
    const { subject, html, text } = lifecycleEmailContent(stage, input)
    const headers = input.unsubscribeUrl ? { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` } : undefined

    await getTransport().sendMail({ to: email, subject, html, text, headers })
}

export const sendAdminSecurityNotice = async (email: string, content: { event: AdminSecurityEvent; when: Date }): Promise<void> => {
    const { subject, html, text } = adminSecurityNoticeContent(content.event, content.when)

    await getTransport().sendMail({ to: email, subject, html, text })
}
