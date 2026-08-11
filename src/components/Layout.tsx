import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { fechaHoy, haceDias } from '../lib/fechas'
import type { Cita, Profile } from '../types'

interface LinkItem { to: string; label: string }
interface GrupoLinks { grupo: string; links: LinkItem[] }

// Menú agrupado por sección (como el resto de pantallas del negocio):
// General = lo que se usa a diario con clientas; Operación = caja/personal;
// Administración = configuración y reportes de fondo.
const linksPorRol: Record<string, GrupoLinks[]> = {
  personal: [
    { grupo: 'General', links: [
      { to: '/jornada', label: 'Mi jornada' },
      { to: '/registro', label: 'Registrar trabajo' }
    ] },
    { grupo: 'Mi cuenta', links: [
      { to: '/mi-comision', label: 'Mi comisión' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/mi-perfil', label: 'Mi perfil' }
    ] }
  ],
  admin: [
    { grupo: 'General', links: [
      { to: '/cobros', label: 'Cobros' },
      { to: '/citas', label: 'Citas' },
      { to: '/usuarios', label: 'Clientes' },
      { to: '/ventas', label: 'Ventas' }
    ] },
    { grupo: 'Operación', links: [
      { to: '/cierre-caja', label: 'Cierre de caja' },
      { to: '/asistencia', label: 'Asistencia' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/jornada', label: 'Mi jornada' }
    ] },
    { grupo: 'Reportes', links: [
      { to: '/reportes', label: 'Reportes' }
    ] }
  ],
  superadmin: [
    { grupo: 'General', links: [
      { to: '/dashboard', label: 'Panel' },
      { to: '/cobros', label: 'Cobros' },
      { to: '/citas', label: 'Citas' },
      { to: '/ventas', label: 'Ventas' }
    ] },
    { grupo: 'Operación', links: [
      { to: '/cierre-caja', label: 'Cierre de caja' },
      { to: '/asistencia', label: 'Asistencia' },
      { to: '/permisos', label: 'Permisos' },
      { to: '/productos', label: 'Inventario' },
      { to: '/contabilidad', label: 'Contabilidad' },
      { to: '/prestamos', label: 'Préstamos' }
    ] },
    { grupo: 'Administración', links: [
      { to: '/historial', label: 'Historial' },
      { to: '/auditoria', label: 'Auditoría' },
      { to: '/usuarios', label: 'Usuarios' },
      { to: '/servicios', label: 'Servicios' }
    ] }
  ]
}

const ETIQUETA_ROL: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  personal: 'Personal'
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

// Campanita de la profesional: sus propias citas asignadas para hoy.
// Es solo informativa (ella no confirma ni reprograma), un respaldo del
// aviso push por si no dio el permiso o el celular no lo mostró.
async function consultarMisCitasHoy(empleadaId: string): Promise<Cita[]> {
  const { data } = await supabase
    .from('citas')
    .select('*')
    .eq('empleada_id', empleadaId)
    .eq('fecha', fechaHoy())
    .in('estado', ['pendiente', 'confirmada'])
    .order('hora')
  return (data as Cita[]) ?? []
}

function useMisCitasHoy(empleadaId: string | undefined) {
  const [citas, setCitas] = useState<Cita[]>([])
  const location = useLocation()

  useEffect(() => {
    if (!empleadaId) return
    const id = empleadaId
    let cancelado = false
    async function tick() {
      const datos = await consultarMisCitasHoy(id)
      if (!cancelado) setCitas(datos)
    }
    tick()
    const intervalo = setInterval(tick, 30000)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
  }, [empleadaId, location.pathname])

  return citas
}

function formatearFechaCorta(fecha: string) {
  const [, mes, dia] = fecha.split('-')
  return `${dia}/${mes}`
}

// Cumpleaños de mañana: se compara mes/día de fecha_nacimiento del personal
// activo contra la fecha de mañana (no el año, para que aplique todos los años).
async function consultarCumpleanosManana(): Promise<Profile[]> {
  const manana = haceDias(-1)
  const [, mesManana, diaManana] = manana.split('-')
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('rol', 'personal')
    .eq('activo', true)
    .not('fecha_nacimiento', 'is', null)
  return ((data as Profile[]) ?? []).filter((p) => {
    if (!p.fecha_nacimiento) return false
    const [, mes, dia] = p.fecha_nacimiento.split('-')
    return mes === mesManana && dia === diaManana
  })
}

function useCumpleanosManana(activo: boolean) {
  const [personas, setPersonas] = useState<Profile[]>([])
  useEffect(() => {
    if (!activo) return
    let cancelado = false
    consultarCumpleanosManana().then((datos) => { if (!cancelado) setPersonas(datos) })
    return () => { cancelado = true }
  }, [activo])
  return personas
}

interface CampanitaProps {
  citasPendientes: Cita[]
  cumpleanosManana: Profile[]
  onAbrirCita: (c: Cita) => void
  onMarcarVisto: (c: Cita) => void
}

// Componente ESTABLE a nivel de módulo (no se define dentro de Layout):
// si se recreara en cada render, React desmontaría y volvería a montar todo
// el desplegable en cada actualización (p. ej. cada 30s al refrescar la
// campanita), lo que puede perder el clic de un botón a medio camino.
function Campanita({ citasPendientes, cumpleanosManana, onAbrirCita, onMarcarVisto }: CampanitaProps) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const totalAvisos = citasPendientes.length + cumpleanosManana.length

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
        className="relative p-2 rounded-lg text-gray-300 hover:bg-white/10"
        aria-label="Notificaciones de citas"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {totalAvisos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {totalAvisos > 9 ? '9+' : totalAvisos}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute left-0 bottom-full mb-1 w-80 max-w-[85vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">🔔 Solicitudes y cambios por revisar</h3>
          </div>
          {cumpleanosManana.length > 0 && (
            <div className="p-3 border-b border-gray-100 bg-pink-50">
              <p className="text-sm font-medium text-brand-700">🎂 Cumpleaños mañana</p>
              <p className="text-xs text-gray-600 mt-0.5">{cumpleanosManana.map((p) => p.nombre).join(', ')}</p>
            </div>
          )}
          {citasPendientes.length === 0 ? (
            cumpleanosManana.length === 0 && (
              <p className="p-4 text-sm text-gray-400">No hay nada pendiente por revisar.</p>
            )
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

function CampanitaPersonal({ citas, onIrARegistro }: { citas: Cita[]; onIrARegistro: () => void }) {
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
        className="relative p-2 rounded-lg text-gray-300 hover:bg-white/10"
        aria-label="Tus citas de hoy"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {citas.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {citas.length > 9 ? '9+' : citas.length}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute left-0 bottom-full mb-1 w-80 max-w-[85vw] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-y-auto">
          <div className="p-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">🔔 Tus citas de hoy</h3>
          </div>
          {citas.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No tienes citas asignadas hoy.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {citas.map((c) => (
                <li key={c.id} className="p-3 space-y-1">
                  <p className="text-sm font-medium">
                    <span className="text-brand-600">{c.hora.slice(0, 5)}</span> · {c.cliente_nombre}
                  </p>
                  {c.nota_interna && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-0.5">📌 {c.nota_interna}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="p-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { setAbierto(false); onIrARegistro() }}
              className="w-full text-xs text-blue-700 underline font-medium text-center py-1"
            >
              Ir a Registrar trabajo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { profile, session, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuAbierto, setMenuAbierto] = useState(false)
  usePushNotifications()
  const grupos = profile ? linksPorRol[profile.rol] ?? [] : []
  const puedeVerCitas = profile?.rol === 'admin' || profile?.rol === 'superadmin'
  const esPersonal = profile?.rol === 'personal'
  const { citas: citasPendientes, recargar } = useCitasPendientes(puedeVerCitas)
  const cumpleanosManana = useCumpleanosManana(puedeVerCitas)
  const misCitasHoy = useMisCitasHoy(esPersonal ? profile?.id : undefined)
  // Manual de uso: la dueña ve todo el manual, los demás roles ven solo su sección.
  const manualHref = `/manual.html?rol=${profile?.rol ?? ''}`
  const usuarioLogin = session?.user?.email?.split('@')[0] ?? ''

  async function marcarVisto(c: Cita) {
    await supabase.from('citas').update({ reprogramada: false }).eq('id', c.id)
    recargar()
  }

  function abrirEnCitas(c: Cita) {
    setMenuAbierto(false)
    navigate('/citas', { state: { citaParaAbrir: c } })
  }

  function irARegistro() {
    setMenuAbierto(false)
    navigate('/registro')
  }

  const claseLink = ({ isActive }: { isActive: boolean }) =>
    `block text-sm px-3 py-2 rounded-lg transition ${isActive ? 'bg-brand-600/25 text-white font-medium' : 'text-gray-300 hover:bg-white/5'}`

  const contenidoSidebar = (
    <>
      <div className="px-5 pt-6 pb-4">
        <p className="font-serif text-[15px] font-bold text-brand-100 leading-tight">Yessica Arango</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 mt-0.5">Nail &amp; Beauty Experts</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {grupos.map((g) => (
          <div key={g.grupo} className="mb-3">
            <p className="px-3 pb-1 text-[10px] uppercase tracking-[0.12em] text-gray-500 font-semibold">{g.grupo}</p>
            <div className="space-y-0.5">
              {g.links.map((l) => (
                <NavLink key={l.to} to={l.to} onClick={() => setMenuAbierto(false)} className={claseLink}>
                  {l.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
        <a href={manualHref} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg text-gray-300 hover:bg-white/10" aria-label="Ayuda: manual de uso">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
            <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
          </svg>
        </a>
        {puedeVerCitas && (
          <Campanita citasPendientes={citasPendientes} cumpleanosManana={cumpleanosManana} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
        )}
        {esPersonal && (
          <CampanitaPersonal citas={misCitasHoy} onIrARegistro={irARegistro} />
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-sm font-medium text-white truncate">{profile?.nombre}</p>
        <p className="text-[11px] text-gray-500 truncate">
          {usuarioLogin || (profile ? ETIQUETA_ROL[profile.rol] : '')}
        </p>
        <button onClick={signOut} className="text-xs text-red-400 hover:text-red-300 mt-1.5">Salir</button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen md:flex">
      {/* Barra superior — solo móvil: da acceso al menú lateral */}
      <header className="md:hidden bg-[#151113] border-b border-white/10 sticky top-0 z-20 flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          <span className="font-serif text-sm font-bold text-brand-100 truncate">Yessica Arango</span>
        </div>
        <div className="flex items-center gap-1">
          {puedeVerCitas && (
            <Campanita citasPendientes={citasPendientes} cumpleanosManana={cumpleanosManana} onAbrirCita={abrirEnCitas} onMarcarVisto={marcarVisto} />
          )}
          {esPersonal && (
            <CampanitaPersonal citas={misCitasHoy} onIrARegistro={irARegistro} />
          )}
          <button
            onClick={() => setMenuAbierto((v) => !v)}
            className="p-2 -mr-1 text-gray-300"
            aria-label="Menú"
          >
            {menuAbierto ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Fondo oscuro al abrir el menú en móvil */}
      {menuAbierto && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMenuAbierto(false)} />
      )}

      {/* Menú lateral: fijo en escritorio, cajón deslizable en móvil */}
      <aside
        className={`bg-[#151113] flex flex-col fixed inset-y-0 left-0 w-64 z-40 transform transition-transform duration-200 md:static md:translate-x-0 md:shrink-0 ${
          menuAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {contenidoSidebar}
      </aside>

      <div className="flex-1 min-w-0">
        <main>
          <Outlet />
        </main>

        <footer className="text-center text-[11px] text-gray-300 py-4">
          Developed by Vulpex Software SAS
        </footer>
      </div>
    </div>
  )
}
