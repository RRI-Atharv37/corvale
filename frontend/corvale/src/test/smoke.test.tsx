import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'

describe('frontend test infrastructure smoke test', () => {
  it('renders a component through the shared provider wrapper', () => {
    renderWithProviders(<div>hello offline world</div>, { withUser: false, withWorkspace: false })
    expect(screen.getByText('hello offline world')).toBeInTheDocument()
  })
})
