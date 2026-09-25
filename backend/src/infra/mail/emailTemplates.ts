import type { DunningStage } from '@core/billing/dunning'
import type { LifecycleEmailStage } from '@core/billing/lifecycleEmail'
import type { RetentionStage } from '@core/billing/retention'

const formatExpiry = (expiryMs: number): string => {
    const hours = expiryMs / (60 * 60 * 1000)
    if (hours < 1) {
        return `${Math.round(expiryMs / (60 * 1000))} minutes`
    }
    if (hours === 1) {
        return '1 hour'
    }
    if (hours < 24) {
        return `${Math.round(hours)} hours`
    }
    const days = Math.round(hours / 24)
    return days === 1 ? '1 day' : `${days} days`
}

const baseEmailTemplate = (title: string, bodyHtml: string): string => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#111827;padding:24px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:600;">Corvale</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">Corvale - personal finance tracker</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`

const ctaButton = (url: string, label: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="border-radius:6px;background-color:#111827;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td>
  </tr>
</table>
`

export const passwordResetEmailHtml = (resetUrl: string, expiryMs: number): string => {
    const body = `
        <p style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.5;">
            We received a request to reset the password for your Corvale account.
        </p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
            Click the button below to choose a new password. This link expires in ${formatExpiry(expiryMs)}.
        </p>
        ${ctaButton(resetUrl, 'Reset password')}
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
            If you didn't request this, you can safely ignore this email - your password won't be changed.
        </p>
    `
    return baseEmailTemplate('Reset your password', body)
}

export const emailVerificationEmailHtml = (verifyUrl: string, expiryMs: number): string => {
    const body = `
        <p style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.5;">
            Thanks for signing up for Corvale! Confirm this is your email address to finish setting up your account.
        </p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
            Click the button below to verify your email. This link expires in ${formatExpiry(expiryMs)}.
        </p>
        ${ctaButton(verifyUrl, 'Verify email')}
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
            If you didn't create a Corvale account, you can safely ignore this email.
        </p>
    `
    return baseEmailTemplate('Verify your email', body)
}

export interface DunningEmailContent {
    subject: string
    html: string
    text: string
}

const paragraph = (text: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">${text}</p>`

const formatUtcDate = (date: Date): string =>
    date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export const dunningEmailContent = (stage: DunningStage, graceEndsAt: Date, billingUrl: string): DunningEmailContent => {
    const endsOn = formatUtcDate(graceEndsAt)
    const keepsWorking = 'Your data is safe and stays readable, and you can export it at any time.'

    const copy: Record<DunningStage, { subject: string; title: string; lines: string[]; cta: string }> = {
        payment_failed: {
            subject: "We couldn't process your Corvale payment",
            title: "Your payment didn't go through",
            lines: [
                `We couldn't charge your payment method for your Corvale subscription. Nothing has changed yet: you can keep using Corvale as normal until ${endsOn}.`,
                'Please update your payment method so the next attempt succeeds.',
            ],
            cta: 'Update payment method',
        },
        reminder: {
            subject: 'Reminder: update your Corvale payment method',
            title: 'Your payment is still outstanding',
            lines: [
                `Your Corvale payment is still unpaid. Corvale keeps working until ${endsOn}; after that your account becomes read-only.`,
                keepsWorking,
            ],
            cta: 'Update payment method',
        },
        final_warning: {
            subject: 'Last chance: your Corvale account turns read-only tomorrow',
            title: 'Your account turns read-only tomorrow',
            lines: [
                `Unless the payment goes through, your Corvale account becomes read-only on ${endsOn}. You will not be able to add or change data until it is paid.`,
                keepsWorking,
            ],
            cta: 'Update payment method',
        },
        access_paused: {
            subject: 'Your Corvale account is now read-only',
            title: 'Your account is now read-only',
            lines: [
                'We still could not collect your payment, so your Corvale account is read-only. You can view everything and export or back up your data at any time, but you cannot add or change anything.',
                'Update your payment method and everything picks up exactly where you left off. Nothing has been deleted.',
            ],
            cta: 'Restore full access',
        },
    }

    const { subject, title, lines, cta } = copy[stage]
    const html = baseEmailTemplate(title, `${lines.map(paragraph).join('')}${ctaButton(billingUrl, cta)}`)
    const text = `${lines.join('\n\n')}\n\n${cta}: ${billingUrl}`

    return { subject, html, text }
}

export const retentionEmailContent = (stage: RetentionStage, deletionDate: Date, billingUrl: string): DunningEmailContent => {
    const deletesOn = formatUtcDate(deletionDate)
    const exportAnytime = 'You can export a full copy of your data, including receipts, from Settings at any time - even while your account is read-only.'
    const restore = 'Reactivate your subscription before then and everything is exactly as you left it, with nothing to set up again.'

    const copy: Record<RetentionStage, { subject: string; title: string; lines: string[]; cta: string }> = {
        notice: {
            subject: 'Your Corvale account is read-only, and your data is kept until ' + deletesOn,
            title: 'Your data is kept until ' + deletesOn,
            lines: [
                `Your Corvale account is read-only. You can still view everything. We keep your data until ${deletesOn}, and after that it is permanently deleted.`,
                exportAnytime,
                restore,
            ],
            cta: 'Reactivate',
        },
        reminder: {
            subject: 'Your Corvale data will be deleted on ' + deletesOn,
            title: 'Your data will be deleted on ' + deletesOn,
            lines: [
                `Your Corvale account is still read-only. On ${deletesOn} your account, records and receipts will be permanently deleted, and this cannot be undone.`,
                exportAnytime,
                restore,
            ],
            cta: 'Reactivate',
        },
        final_warning: {
            subject: 'Final notice: your Corvale data is deleted on ' + deletesOn,
            title: 'Your data is deleted on ' + deletesOn,
            lines: [
                `This is the last notice. On ${deletesOn} your Corvale account, records and receipts will be permanently deleted, and this cannot be undone.`,
                exportAnytime,
                restore,
            ],
            cta: 'Reactivate',
        },
    }

    const { subject, title, lines, cta } = copy[stage]
    const html = baseEmailTemplate(title, `${lines.map(paragraph).join('')}${ctaButton(billingUrl, cta)}`)
    const text = `${lines.join('\n\n')}\n\n${cta}: ${billingUrl}`

    return { subject, html, text }
}

export interface LifecycleEmailInput {
    trialEndsAt: Date | null
    daysLeft: number
    appUrl: string
    billingUrl: string
    unsubscribeUrl?: string
}

const daysPhrase = (days: number): string => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`)
const daysCount = (days: number): string => (days === 1 ? '1 day' : `${days} days`)

export const lifecycleEmailContent = (stage: LifecycleEmailStage, input: LifecycleEmailInput): DunningEmailContent => {
    const { trialEndsAt, daysLeft, appUrl, billingUrl, unsubscribeUrl } = input
    const endsOn = trialEndsAt ? formatUtcDate(trialEndsAt) : 'the end of your trial'
    const exportAnytime = 'You can export a full copy of your data from Settings → Backup and Restore at any time, including while your account is read-only.'
    const readOnlyNote =
        'When the trial ends your account becomes read-only: you can still view and export everything, but you cannot add or change anything until you choose a plan.'

    const copy: Record<LifecycleEmailStage, { subject: string; title: string; lines: string[]; cta: string; url: string }> = {
        trial_welcome: {
            subject: 'Your Corvale trial has started',
            title: 'Your Corvale trial has started',
            lines: [
                `You have full access to Corvale until ${endsOn}. No payment details are needed and nothing is charged automatically.`,
                exportAnytime,
            ],
            cta: 'Open Corvale',
            url: appUrl,
        },
        trial_day_7: {
            subject: `${daysCount(daysLeft)} left in your Corvale trial`,
            title: `${daysCount(daysLeft)} left in your trial`,
            lines: [
                `Your Corvale trial runs until ${endsOn}. If you have a bank export, importing a CSV or OFX file is the quickest way to see a full month in one place.`,
                readOnlyNote,
            ],
            cta: 'Open Corvale',
            url: appUrl,
        },
        trial_day_21: {
            subject: `${daysCount(daysLeft)} left in your Corvale trial`,
            title: `${daysCount(daysLeft)} left in your trial`,
            lines: [`You have ${daysCount(daysLeft)} left: your Corvale trial ends on ${endsOn}.`, readOnlyNote, exportAnytime],
            cta: 'See plans',
            url: billingUrl,
        },
        trial_ending: {
            subject: `Your Corvale trial ends ${daysPhrase(daysLeft)}`,
            title: `Your trial ends ${daysPhrase(daysLeft)}`,
            lines: [
                `Your Corvale trial ends on ${endsOn}. ${readOnlyNote}`,
                'Nothing is deleted when the trial ends, and choosing a plan later picks up exactly where you left off.',
            ],
            cta: 'Choose a plan',
            url: billingUrl,
        },
        trial_expired: {
            subject: 'Your Corvale trial has ended',
            title: 'Your trial has ended',
            lines: [
                'Your Corvale account is now read-only. You can view everything and export your data at any time, but you cannot add or change anything.',
                'Choose a plan and everything picks up exactly where you left off. Nothing has been deleted.',
            ],
            cta: 'Choose a plan',
            url: billingUrl,
        },
        win_back: {
            subject: 'Your Corvale data is still here',
            title: 'Your data is still here',
            lines: [
                'Your Corvale account has been read-only for a couple of weeks. Your accounts, transactions and receipts are all still there, and you can view or export them at any time.',
                'If you would like to start adding to them again, you can reactivate from your billing page and everything continues from where you stopped. This is the only email of this kind we will send you.',
            ],
            cta: 'Reactivate',
            url: billingUrl,
        },
    }

    const { subject, title, lines, cta, url } = copy[stage]
    const unsubscribeHtml = unsubscribeUrl
        ? `<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">Do not want emails like this? <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>.</p>`
        : ''
    const html = baseEmailTemplate(title, `${lines.map(paragraph).join('')}${ctaButton(url, cta)}${unsubscribeHtml}`)
    const unsubscribeText = unsubscribeUrl ? `\n\nDo not want emails like this? Unsubscribe: ${unsubscribeUrl}` : ''
    const text = `${lines.join('\n\n')}\n\n${cta}: ${url}${unsubscribeText}`

    return { subject, html, text }
}

export type AdminSecurityEvent = 'totp_reset' | 'break_glass'

export const adminSecurityNoticeContent = (event: AdminSecurityEvent, when: Date): DunningEmailContent => {
    const at = when.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    const summary =
        event === 'break_glass'
            ? 'An operator with shell access on the server reset an admin account with the break-glass procedure.'
            : 'An owner reset the authenticator on an admin account.'

    const body = [
        paragraph(summary),
        paragraph(`When: ${at}.`),
        paragraph(
            'All sessions for that account were ended and it cannot sign in until it is enrolled again. ' +
                'Sensitive actions stay blocked for 24 hours after re-enrolment.'
        ),
        paragraph('If you did not expect this, treat it as a security incident and review the audit log.'),
    ].join('')

    return {
        subject: 'Corvale admin security notice',
        html: baseEmailTemplate('Admin security notice', body),
        text: `${summary} When: ${at}. If you did not expect this, treat it as a security incident.`,
    }
}
