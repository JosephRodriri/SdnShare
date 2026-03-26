import { Navigate } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'

export default function AdminRoute({ children }) {
  const { isAdmin } = useRole()
  return isAdmin ? children : <Navigate to="/dashboard" replace />
}
