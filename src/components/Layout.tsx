import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'
import type { Cita } from '../types'

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

// Citas que necesitan atención: solicitudes pendientes o ya confirmadas que
// se reprogramaron. Se avisa sin importar la fecha ni la página en la que
// esté la administradora (se agenden internamente o las pida la clienta).
async function consultarCitasPendientes(): Promise<Cita[]> {
  const { data } = await supabase
    .from('citas')
    .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
    .or('estado.eq.pendiente,reprogramada.eq.true')
    .order('fecha')
    .order('hora')
  return (data as Cita[]) ?? []
}

function useCitasPendientes(activo: boolean) {
  const [citas, setCitas] = useState<Cita[]>([])
  const location = useLocation()

  async function recargar() {
    setCitas(await consultarCitasPendientes())
  }

  useEffect(() => {
    if (!activo) return
    let cancelado = false
    async function tick() {
      const datos = await consultarCitasPendientes()
      if (!cancelado) setCitas(datos)
    }
    tick()
    const intervalo = setInterval(tick, 30000)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
    // Se refresca también al cambiar de página (p. ej. tras confirmar una cita).
  }, [activo, location.pathname])

  return { citas, recargar }
}

function formatearFechaCorta(fecha: string) {
  const [, mes, dia] = fecha.split('-')
  return `${dia}/${mes}`
}

interface CampanitaProps {
  citasPendientes: Cita[]
  onAbrirCita: (c: Cita) => void
  onMarcarVisto: (c: Cita) => void
}

// Componente ESTABLE a nivel de módulo (no se define dentro de Layout):
// si se recreara en cada render, React desmontaría y volvería a montar todo
// el desplegable en cada actualización (p. ej. cada 30s al refrescar la
// campanita), lo que puede perder el clic de un botón a medio camino.
// Además cada instancia usa su PROPIA ref: como hay una copia para el menú
// de escritorio y otra para el de móvil (una queda oculta por CSS según el
// tamaño de pantalla, pero ambas existen en el DOM), si compartieran una
// sola ref el detector de "clic afuera" podía cerrar el panel por error al
// tocar dentro de la copia que la ref no apuntaba, cancelando el clic real.
function Campanita({ citasPendientes, onAbrirCita, onMarcarVisto }: CampanitaProps) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="relative p-2 text-brand-700"
        aria-label="Notificaciones de citas"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {citasPendientes.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {citasPendientes.length > 9 ? '9+' : citasPendientes.length}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-1 w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">🔔 Solicitudes y cambios por revisar</h3>
          </div>
          {citasPendientes.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No hay nada pendiente por revisar.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {citasPendientes.map((c) => (
                <li key={c.id} className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      <span className="text-brand-600">{formatearFechaCorta(c.fecha)}</span> · {c.hora.slice(0, 5)} · {c.servicio?.nombre ?? 'Servicio'}
                    </p>
                    {c.reprogramada ? (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">Reprogramada</span>
                    ) : (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Pendiente</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{c.cliente_nombre}{c.empleada?.nombre ? ` · ${c.empleada.nombre}` : ''}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                    <button
                      type="button"
                      onClick={() => { setAbierto(false); onAbrirCita(c) }}
                      className="text-xs text-blue-700 underline font-medium"
                    >
                      {c.estado === 'pendiente' ? 'Confirmar' : 'Abrir'}
                    </button>
                    {c.reprogramada && (
                      <button
                        type="button"
                        onClick={() => onMarcarVisto(c)}
                        className="text-xs text-purple-700 underline"
                      >
                        Marcar como visto
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const links = profile ? linksPorRol[profile.rol] ?? [] : []
  const puedeVerCitas = profile?.rol === 'admin' || profile?.rol === 'superadmin'
  const { citas: citasPendientes, recargar } = useCitasPendientes(puedeVerCitas)
  // Manual de uso: la dueña ve todo el manual, los demás roles ven solo su sección.
  const manualHref = `/manual.html?rol=${profile?.rol ?? ''}`

  async function marcarVisto(c: Cita) {
    await supabase.from('citas').update({ reprogramada: false }).eq('id', c.id)
    recargar()
  }

  function abrirEnCitas(c: Cita) {
    setMenuAbierto(false)
    navigate('/citas', { state: { citaParaAbrir: c } })
  }

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
            <a href={manualHref} target="_blank" rel="noopener noreferrer" className="p-2 text-brand-700" aria-label="Ayuda: manual de uso">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
                <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
              </svg>
            </a>
            {puedeVerCitas && (
              <Campanita citasPendientes={citasPendientes} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
            )}
            <span className="mx-1 text-brand-200">|</span>
            <span className="text-sm text-gray-500 max-w-[10rem] truncate">{profile?.nombre}</span>
            <button onClick={signOut} className="text-sm text-gray-400 hover:text-red-500 px-2">Salir</button>
          </nav>

          {/* En móvil: ayuda + campanita siempre visibles + botón hamburguesa */}
          <div className="md:hidden flex items-center gap-1">
            <a href={manualHref} target="_blank" rel="noopener noreferrer" className="p-2 text-brand-700" aria-label="Ayuda: manual de uso">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
                <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
              </svg>
            </a>
            {puedeVerCitas && (
              <Campanita citasPendientes={citasPendientes} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
            )}
            <button
              onClick={() => setMenuAbierto((v) => !v)}
              className="p-2 -mr-2 text-brand-700"
              aria-label="Menú"
            >
              {menuAbierto ? (
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
        {menuAbierto && (
          <nav className="md:hidden border-t border-brand-100 bg-brand-50/95 px-2 py-2 flex flex-col gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMenuAbierto(false)}
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

      <footer className="text-center text-[11px] text-gray-300 py-4">
        Developed by Vulpex Software SAS
      </footer>
    </div>
  )
}
