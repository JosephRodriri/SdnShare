import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import AppLayout      from './components/layout/AppLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import AdminRoute     from './components/auth/AdminRoute'
import LoginPage      from './pages/LoginPage'
import DashboardPage  from './pages/DashboardPage'
import TopologyPage   from './pages/TopologyPage'
import MetricsPage    from './pages/MetricsPage'
import AnomaliesPage  from './pages/AnomaliesPage'
import AlertRulesPage from './pages/AlertRulesPage'
import UsersPage      from './pages/UsersPage'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#161b22', color: '#e6edf3',
            border: '1px solid #30363d',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '12px',
          },
          success: { iconTheme: { primary: '#4ade80', secondary: '#161b22' } },
          error:   { iconTheme: { primary: '#f87171', secondary: '#161b22' } },
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index           element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="topology"  element={<TopologyPage />} />
          <Route path="metrics"   element={<MetricsPage />} />
          <Route path="anomalies" element={<AnomaliesPage />} />
          <Route path="alerts"    element={<AlertRulesPage />} />
          <Route path="users"     element={<AdminRoute><UsersPage /></AdminRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
