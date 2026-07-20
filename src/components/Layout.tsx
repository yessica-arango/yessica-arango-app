import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const linksPorRol: Record<string, { to: string; label: string }[]> = {
  personal: [
    { to: '/jornada', label: 'Mi jornada' },
    { to: '/registro', label: 'Registrar trabajo' },
    { to: '/citas', label: 'Citas' }
  ],
  admin: [
    { to: '/citas', label: 'Citas' },
    { to: '/asistencia', label: 'Asistencia' },
    { to: '/cierre-caja', label: 'Cierre de caja' },
    { to: '/jornada', label: 'Mi jornada' }
  ],
  superadmin: [
    { to: '/dashboard', label: 'Panel' },
    { to: '/cierre-caja', label: 'Cierre de caja' },
    { to: '/citas', label: 'Citas' },
    { to: '/asistencia', label: 'Asistencia' },
    { to: '/usuarios', label: 'Usuarios' },
    { to: '/servicios', label: 'Servicios' }
  ]
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const links = profile ? linksPorRol[profile.rol] ?? [] : []

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-semibold text-brand-700">
            <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-full object-cover" />
            Yessica Arango
          </span>
          <nav className="flex gap-3">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `text-sm px-2 py-1 rounded-lg ${isActive ? 'bg-brand-100 text-brand-700' : 'text-gray-600'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{profile?.nombre}</span>
          <button onClick={signOut} className="text-gray-400 hover:text-red-500">Salir</button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
