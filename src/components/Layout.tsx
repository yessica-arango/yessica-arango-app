import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'

const linksPorRol: Record<string, { to: string; label: string }[]> = {
  personal: [
    { to: '/jornada', label: 'Mi jornada' },
    { to: '/registro', label: 'Registrar trabajo' },
    { to: '/permisos', label: 'Permisos' },
    { to: '/mi-perfil', label: 'Mi perfil' }
  ],
  admin: [
    { to: '/cobros', label: 'Cobros' },
    { to: '/cierre-caja', label: 'Cierre de caja' },
    { to: '/citas', label: 'Citas' },
    { to: '/ventas', label: 'Ventas' },
    { to: '/reportes', label: 'Reportes' },
    { to: '/jornada', label: 'Mi jornada' },
    { to: '/permisos', label: 'Permisos' },
    { to: '/asistencia', label: 'Asistencia' }
  ],
  superadmin: [
    { to: '/dashboard', label: 'Panel' },
    { to: '/cobros', label: 'Cobros' },
    { to: '/cierre-caja', label: 'Cierre de caja' },
    { to: '/citas', label: 'Citas' },
    { to: '/ventas', label: 'Ventas' },
    { to: '/asistencia', label: 'Asistencia' },
    { to: '/permisos', label: 'Permisos' },
    { to: '/contabilidad', label: 'Contabilidad' },
    { to: '/prestamos', label: 'Préstamos' },
    { to: '/productos', label: 'Inventario' },
    { to: '/historial', label: 'Historial' },
    { to: '/auditoria', label: 'Auditoría' },
    { to: '/usuarios', label: 'Usuarios' },
    { to: '/servicios', label: 'Servicios' }
  ]
}

// Campanita: avisa cuántas citas necesitan atención (solicitudes pendientes
// o ya confirmadas que se reprogramaron), sin importar la fecha ni cuál se
// esté viendo en la agenda.
function useCitasPendientes(activo: boolean) {
  const [cantidad, setCantidad] = useState(0)
  const location = useLocation()

  useEffect(() => {
    if (!activo) return
    let cancelado = false
    async function consultar() {
      const { count } = await supabase
        .from('citas')
        .select('id', { count: 'exact', head: true })
        .or('estado.eq.pendiente,reprogramada.eq.true')
      if (!cancelado) setCantidad(count ?? 0)
    }
    consultar()
    const intervalo = setInterval(consultar, 30000)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
    // Se refresca también al cambiar de página (p. ej. tras confirmar una cita).
  }, [activo, location.pathname])

  return cantidad
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const [abierto, setAbierto] = useState(false)
  const links = profile ? linksPorRol[profile.rol] ?? [] : []
  const puedeVerCitas = profile?.rol === 'admin' || profile?.rol === 'superadmin'
  const citasPendientes = useCitasPendientes(puedeVerCitas)

  const claseLink = ({ isActive }: { isActive: boolean }) =>
    `text-sm px-3 py-2 rounded-lg ${isActive ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-brand-50'}`

  const Campanita = () => (
    <NavLink to="/citas" className="relative p-2 text-brand-700" aria-label="Solicitudes de citas pendientes">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {citasPendientes > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
          {citasPendientes > 9 ? '9+' : citasPendientes}
        </span>
      )}
    </NavLink>
  )

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
            {puedeVerCitas && <Campanita />}
            <span className="mx-1 text-brand-200">|</span>
            <span className="text-sm text-gray-500 max-w-[10rem] truncate">{profile?.nombre}</span>
            <button onClick={signOut} className="text-sm text-gray-400 hover:text-red-500 px-2">Salir</button>
          </nav>

          {/* En móvil: campanita siempre visible + botón hamburguesa */}
          <div className="md:hidden flex items-center gap-1">
            {puedeVerCitas && <Campanita />}
            <button
              onClick={() => setAbierto((v) => !v)}
              className="p-2 -mr-2 text-brand-700"
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
