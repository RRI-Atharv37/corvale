import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderWithProviders, screen } from '@/test/test-utils'
import AuthLayout from '../AuthLayout'

describe('AuthLayout', () => {
    it('links guests to the desktop download page', () => {
        renderWithProviders(
            <AuthLayout>
                <div>form</div>
            </AuthLayout>,
            { withUser: false, withWorkspace: false }
        )

        const downloadLink = screen.getByRole('link', { name: /desktop app/i })
        expect(downloadLink).toHaveAttribute('href', '/download')
    })
})
