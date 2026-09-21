import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './components/Layout'
import { StepUpProvider } from './components/StepUp'
import { useAuth } from './lib/auth'
import AdminsPage from './pages/AdminsPage'
import AuditPage from './pages/AuditPage'
import EnrolPage from './pages/EnrolPage'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import SubscriberDetailPage from './pages/SubscriberDetailPage'
import SubscribersPage from './pages/SubscribersPage'

/** A page the role cannot use is not shown at all, rather than shown and refused. */
const Guard = ({ capability, children }: { capability: string; children: React.ReactNode }) => {
  const { hasCapability } = useAuth()
  return hasCapability(capability) ? <>{children}</> : <Navigate to="/" replace />
}

const App = () => (
  <StepUpProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/enrol" element={<EnrolPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<OverviewPage />} />
        <Route path="subscribers" element={<Guard capability="subscribers.read"><SubscribersPage /></Guard>} />
        <Route path="subscribers/:userId" element={<Guard capability="subscribers.read"><SubscriberDetailPage /></Guard>} />
        <Route path="audit" element={<Guard capability="audit.read"><AuditPage /></Guard>} />
        <Route path="admins" element={<Guard capability="admins.manage"><AdminsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </StepUpProvider>
)

export default App
