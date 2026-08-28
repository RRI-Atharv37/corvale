export type DesktopPlatformId = 'windows' | 'macos' | 'linux'
export type DetectedPlatform = DesktopPlatformId | 'unknown'

interface NavigatorLike {
    platform?: string
    userAgent?: string
}

// navigator.platform is deprecated but still the most reliable single signal across browsers;
// userAgentData.platform is the replacement where available. Both are checked, falling back to
// parsing userAgent, since no single source is present on every browser/OS combination.
export const detectPlatform = (nav: NavigatorLike = navigator): DetectedPlatform => {
    const uaDataPlatform = (nav as NavigatorLike & { userAgentData?: { platform?: string } })
        .userAgentData?.platform
    const platform = (uaDataPlatform ?? nav.platform ?? '').toLowerCase()
    const userAgent = (nav.userAgent ?? '').toLowerCase()

    // Mobile UAs can contain "mac" (iOS) or match "linux" (Android) - rule them out first so
    // they fall through to 'unknown' rather than a desktop platform with no installer for it.
    if (/android|iphone|ipad|ipod/.test(userAgent)) return 'unknown'

    if (platform.includes('win') || userAgent.includes('win')) return 'windows'
    if (platform.includes('mac') || userAgent.includes('mac')) return 'macos'
    if (platform.includes('linux') || userAgent.includes('linux')) return 'linux'

    return 'unknown'
}
