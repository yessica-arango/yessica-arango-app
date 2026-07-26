import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const destinoPorRol: Record<string, string> = {
  personal: '/jornada',
  admin: '/cobros',
  superadmin: '/dashboard',
  cliente: '/portal'
}

export default function Home() {
  const { profile } = useAuth()
  if (!profile) return null
  return <Navigate to={destinoPorRol[profile.rol] ?? '/login'} replace />
}
