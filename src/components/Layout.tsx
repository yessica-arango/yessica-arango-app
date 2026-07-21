import { useState } from 'react'
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
  const [abierto, setAbierto] = useState(false)
  const links = profile ? linksPorRol[profile.rol] ?? [] : []

  const claseLink = ({ isActive }: { isActive: boolean }) =>
    `text-sm px-3 py-2 rounded-lg ${isActive ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-brand-50'}`

  return (
    <div className="min-h-screen">
      <header className="bg-brand-50/90 backdrop-blur border-b border-brand-100 sticky top-0 z-20">
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <img src="/icon-192.png" alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
            <span className="min-w-0 leading-tight">
              <span className="block font-semibold text-brand-700 truncate">Yessica Arango</span>
              <span className="block text-[10px] uppercase tracking-wider text-brand-500 truncate">Nail &amp; Beauty Experts</span>
            </span>
          </span>

          {/* Barra en PC / tablet */}
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={claseLink}>{l.label}</NavLink>
            ))}
            <span className="mx-1 text-brand-200">|</span>
            <span className="text-sm text-gray-500 max-w-[10rem] truncate">{profile?.nombre}</span>
            <button onClick={signOut} className="text-sm text-gray-400 hover:text-red-500 px-2">Salir</button>
          </nav>

          {/* Botón hamburguesa en móvil */}
          <button
            onClick={() => setAbierto((v) => !v)}
            className="md:hidden p-2 -mr-2 text-brand-700"
            aria-label="Menú"
          >
            {abierto ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Menú desplegable en móvil */}
        {abierto && (
          <nav className="md:hidden border-t border-brand-100 bg-brand-50/95 px-2 py-2 flex flex-col gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setAbierto(false)}
                className={({ isActive }) =>
                  `px-3 py-2.5 rounded-lg text-sm ${isActive ? 'bg-brand-100 text-brand-700 font-medium' : 'text-gray-700'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <div className="flex items-center justify-between px-3 pt-2 mt-1 border-t border-brand-100">
              <span className="text-sm text-gray-500 truncate">{profile?.nombre}</span>
              <button onClick={signOut} className="text-sm font-medium text-red-500">Salir</button>
            </div>
          </nav>
        )}
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  )
}
