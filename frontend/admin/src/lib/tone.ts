export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export const statusTone = (status: string | null | undefined): Tone => {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'good'
    case 'past_due':
      return 'warn'
    case 'trial_expired':
    case 'cancelled':
    case 'none':
      return 'bad'
    default:
      return 'neutral'
  }
}
