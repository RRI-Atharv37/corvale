import React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
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
