export const OMITTED_SECTIONS_NOTICE =
    'Exported without your reconciliation sessions, saved reports, saver history, profile, devices and workspace memberships: they are kept on our servers and need a connection. Export again online to include them.'

export const hasOmittedSections = (result: { omittedSections?: string[] } | void): boolean =>
    (result?.omittedSections?.length ?? 0) > 0
