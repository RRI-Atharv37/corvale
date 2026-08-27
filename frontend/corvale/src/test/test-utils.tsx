import React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import UserProvider from '../context/UserContext'
import WorkspaceProvider from '../context/WorkspaceContext'

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  withUser?: boolean
  withWorkspace?: boolean
}

export const AllProviders: React.FC<{
  children: ReactNode
  route?: string
  withUser?: boolean
  withWorkspace?: boolean
}> = ({ children, route = '/', withUser = true, withWorkspace = true }) => {
  let tree = <>{children}</>

  if (withWorkspace) {
    tree = <WorkspaceProvider>{tree}</WorkspaceProvider>
  }
  if (withUser) {
    tree = <UserProvider>{tree}</UserProvider>
  }

  return <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>
}

export const renderWithProviders = (ui: ReactElement, options: RenderWithProvidersOptions = {}) => {
  const { route, withUser, withWorkspace, ...renderOptions } = options
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders route={route} withUser={withUser} withWorkspace={withWorkspace}>
        {children}
      </AllProviders>
    ),
    ...renderOptions,
  })
}

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

/**
 * Drives the {@link CategoryPicker} combobox (V4): focuses the input, then clicks the option whose
 * accessible name starts with `optionName` (so `"Food"` matches the master option
 * `"Food (master category)"`). Pass `scope` (a dialog or form element) when a page renders more than
 * one picker; it defaults to the whole screen.
 */
export async function pickCategory(
  user: UserEvent,
  optionName: string,
  scope?: HTMLElement
): Promise<void> {
  const root = scope ? within(scope) : screen
  const input = root.getByRole('combobox', { name: /categor/i })
  await user.click(input)
  const option = await root.findByRole('option', {
    name: new RegExp('^' + optionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  })
  await user.click(option)
}
