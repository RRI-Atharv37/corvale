import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderWithProviders, screen } from '../../test/test-utils'
import Landing from '../Landing'

describe('Landing page', () => {
    it('links to the desktop download page from the nav', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        const navLinks = screen.getAllByRole('link', { name: /download/i })
        expect(navLinks.some((link) => link.getAttribute('href') === '/download')).toBe(true)
    })

    it('links to the desktop download page from the hero', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        expect(screen.getByText(/prefer an installed app/i)).toBeInTheDocument()
        const heroLink = screen.getByRole('link', { name: /get the desktop app/i })
        expect(heroLink).toHaveAttribute('href', '/download')
    })

    it('links to the desktop download page from the footer', () => {
        renderWithProviders(<Landing />, { withUser: false, withWorkspace: false })

        const downloadLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/download')
        expect(downloadLinks.length).toBeGreaterThanOrEqual(3)
    })
})
