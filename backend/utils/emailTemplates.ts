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
                <span style="color:#ffffff;font-size:20px;font-weight:600;">spndr</span>
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
                <p style="margin:0;font-size:12px;color:#9ca3af;">spndr — personal finance tracker</p>
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
            We received a request to reset the password for your spndr account.
        </p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
            Click the button below to choose a new password. This link expires in ${formatExpiry(expiryMs)}.
        </p>
        ${ctaButton(resetUrl, 'Reset password')}
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
            If you didn't request this, you can safely ignore this email — your password won't be changed.
        </p>
    `
    return baseEmailTemplate('Reset your password', body)
}

export const emailVerificationEmailHtml = (verifyUrl: string, expiryMs: number): string => {
    const body = `
        <p style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.5;">
            Thanks for signing up for spndr! Confirm this is your email address to finish setting up your account.
        </p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
            Click the button below to verify your email. This link expires in ${formatExpiry(expiryMs)}.
        </p>
        ${ctaButton(verifyUrl, 'Verify email')}
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
            If you didn't create a spndr account, you can safely ignore this email.
        </p>
    `
    return baseEmailTemplate('Verify your email', body)
}
