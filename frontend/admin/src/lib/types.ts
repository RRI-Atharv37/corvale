export type AdminRole = 'support' | 'finance' | 'owner'
export type AdminStatus = 'pending' | 'active' | 'reenrol' | 'disabled'

export interface AdminIdentity {
  id: string
  email: string
  role: AdminRole
}

export interface Session {
  accessToken: string
  expiresInSeconds: number
  sessionExpiresAt?: string
  stepUpUntil?: string | null
  capabilities?: string[]
  admin: AdminIdentity
}

export interface MeResponse {
  admin: AdminIdentity
  session: { expiresAt: string; idleExpiresAt: string; stepUpUntil: string | null }
  moneyBlockedUntil: string | null
  capabilities: string[]
}

export interface EnrolStart {
  email: string
  role: AdminRole
  secret: string
  otpauthUri: string
  requiresPassword: boolean
}

export interface Meta {
  plans: string[]
  statuses: string[]
  grandfatherKinds: string[]
  dunningStages: string[]
  retentionStages: string[]
  grantKinds: string[]
  roles: AdminRole[]
  auditActions?: string[]
  caps: { grantDays: number; erasureHoldDays: number }
}

export interface SubscriberListItem {
  userId: string
  email: string
  planCode: string | null
  status: string | null
  resolvedStatus: string
  canWrite: boolean
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDueSince: string | null
  dunningStage: string | null
  retentionStage: string | null
  grandfatherKind: string | null
  hasAdminGrant: boolean
  onRetentionHold: boolean
  providerLinked: boolean
  providerSubscriptionId: string | null
  lastEventAt: string | null
}

export interface SubscriberListResponse {
  subscribers: SubscriberListItem[]
  total: number
  page: number
  limit: number
}

export interface SubscriberFilters {
  page: number
  limit?: number
  status?: string
  plan?: string
  grandfatherKind?: string
  dunningStage?: string
  retentionStage?: string
  providerLinked?: string
  hasAdminGrant?: string
  trialEndingWithinDays?: string
}

export interface AdminGrantView {
  kind: string
  planCode: string | null
  until: string
  limits: Record<string, number | null> | null
  grantedBy: string | null
  grantedAt: string | null
}

export interface SubscriptionView {
  id: string
  planCode: string
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDueSince: string | null
  dunningStage: string | null
  lapsedAt: string | null
  retentionStage: string | null
  retentionStageAt: string | null
  grandfatherKind: string | null
  adminGrant: AdminGrantView | null
  retentionHoldUntil: string | null
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  lastEventAt: string | null
  createdAt: string
  updatedAt: string
}

export interface HistoryEntry {
  id: string
  at: string
  action: string
  adminId: string | null
  adminRole: AdminRole | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string | null
}

export interface SubscriberDetail {
  account: { userId: string; email: string; createdAt: string; isEmailVerified: boolean }
  legal: { termsVersion: string | null; privacyVersion: string | null; acceptedAt: string | null; ageAttested: boolean | null }
  subscription: SubscriptionView | null
  entitlements: {
    billingEnabled: boolean
    status: string
    planCode: string | null
    canWrite: boolean
    canSyncPush: boolean
    features: Record<string, boolean>
    limits: { receiptStorageBytes: number | null; syncDevices: number | null; workspaceMembers: number | null }
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    graceEndsAt: string | null
    writableUntil: string | null
  }
  readOnly: { canWrite: boolean; code: string; message: string }
  usage: {
    receiptBytes: { used: number; limit: number | null }
    syncDevices: { used: number; limit: number | null }
    workspaceMembers: { used: number; limit: number | null }
  }
  devices: { deviceRef: string; kind: string | null; firstSeenAt: string; lastSeenAt: string; canPush: boolean }[]
  workspaces: { id: string; seatCount: number }[]
  billingEvents: {
    id: string
    type: string
    occurredAt: string
    processedAt: string | null
    error: string | null
    redacted: boolean
    payload: Record<string, unknown>
  }[]
  erasure: {
    retentionEnabled: boolean
    retentionDays: number
    lapsedAt: string | null
    projectedEraseAt: string | null
    lastNoticeStage: string | null
    lastNoticeAt: string | null
    held: boolean
  }
  adminHistory: HistoryEntry[]
}

export interface JobStatus {
  lastRun: { startedAt: string; finishedAt: string | null; ok: boolean; exitCode: number | null; counts: Record<string, number>; error: string | null } | null
  stale: boolean
}

export interface OpsHealth {
  billingEnabled: boolean
  retentionEnabled: boolean
  unprocessedEvents: { count: number; recent: { type: string; occurredAt: string; error: string | null }[] }
  pastDueNearGraceEnd: { hours: number; count: number; items: { userId: string; graceEndsAt: string }[] }
  upcomingErasures: { days: number; retentionEnabled: boolean; count: number; items: { userId: string; eraseOn: string }[] }
  jobs: Record<'sweep:billing' | 'reconcile:billing', JobStatus>
}

export interface AuditEntry {
  id: string
  at: string
  adminId: string | null
  adminRole: AdminRole | null
  actorType: 'admin' | 'system'
  action: string
  subjectUserId: string | null
  subjectSubscriptionId: string | null
  targetAdminId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  amountMinor: number | null
  currency: string | null
  reason: string | null
  requestId: string | null
  ip: string | null
}

export interface AuditResponse {
  entries: AuditEntry[]
  total: number
  page: number
  limit: number
}

export interface AdminListItem {
  id: string
  email: string
  role: AdminRole
  status: AdminStatus
  lastLoginAt: string | null
  moneyBlockedUntil: string | null
  createdAt: string
}

export interface EnrolmentGrant {
  adminId: string
  enrolmentToken: string
  expiresAt: string
}
