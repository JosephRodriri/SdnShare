import { useAuthStore } from '../store/authStore'

export function useRole() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'ADMIN'
  const isUser  = user?.role === 'USER'
  return { isAdmin, isUser, role: user?.role }
}
