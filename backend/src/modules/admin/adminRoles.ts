export const ADMIN_ROLES = ['support', 'finance', 'owner'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const ADMIN_STATUSES = ['pending', 'active', 'reenrol', 'disabled'] as const
export type AdminStatus = (typeof ADMIN_STATUSES)[number]

export const ADMIN_CAPABILITIES = [
    'subscribers.read',
    'ops.read',
    'metrics.read',
    'grants.write',
    'money.write',
    'grandfather.write',
    'audit.read',
    'admins.manage',
] as const
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]

const ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
    support: ['subscribers.read', 'ops.read', 'grants.write'],
    finance: ['subscribers.read', 'ops.read', 'metrics.read', 'money.write'],
    owner: [...ADMIN_CAPABILITIES],
}

export const roleCan = (role: AdminRole, capability: AdminCapability): boolean => ROLE_CAPABILITIES[role].includes(capability)

export const capabilitiesOf = (role: AdminRole): AdminCapability[] => [...ROLE_CAPABILITIES[role]]

export const isAdminRole = (value: unknown): value is AdminRole =>
    typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value)
