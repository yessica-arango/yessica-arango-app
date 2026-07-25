import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, crearClienteEfimero } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { linkWhatsApp, mensajeCita } from '../lib/whatsapp'
import { fechaHoy as hoy } from '../lib/fechas'
import { DOMINIO_INTERNO } from '../lib/authDominio'
import { METODOS_PAGO, type Cita, type EstadoCita, type Profile, type Servicio } from '../types'

const ESTADO_ESTILOS: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-blue-100 text-blue-700',
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-gray-200 text-gray-500'
}

// Obsequios disponibles: los elige la dueña o la administradora según disponibilidad.
const OBSEQUIOS = [
  'Veloterapia',
  'Chocolaterapia',
  'Mascarilla menta',
  'Polvo espumoso',
  'Jelly spa',
  'Parafina'
]

const ORDEN_ESTADOS: EstadoCita[] = ['pendiente', 'confirmada', 'completada', 'cancelada']
const ETIQUETA_ESTADO: Record<EstadoCita, string> = {
  pendiente: 'Pendientes',
  confirmada: 'Confirmadas',
  completada: 'Completadas',
  cancelada: 'Canceladas'
}

interface ClienteLite { id: string; nombre: string; telefono: string | null; cedula: string | null }

export default function Citas() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(hoy())
  const [citas, setCitas] = useState<Cita[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [empleadas, setEmpleadas] = useState<Profile[]>([])

  const [empleadaId, setEmpleadaId] = useState('')
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  const [cedula, setCedula] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [infoCedula, setInfoCedula] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ClienteLite[]>([])
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [fechaCita, setFechaCita] = useState(hoy())
  const [hora, setHora] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [abono, setAbono] = useState('')
  const [abonoMetodo, setAbonoMetodo] = useState('')
  const [obsequio, setObsequio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaCreada, setUltimaCreada] = useState<Cita | null>(null)

  async function cargarCitas() {
    const { data } = await supabase
      .from('citas')
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .eq('fecha', fecha)
      .order('hora')
    setCitas((data as Cita[]) ?? [])
  }

  useEffect(() => {
    cargarCitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha])

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
      .then(({ data }) => setServicios(data ?? []))
    // Cualquier profesional activa puede recibir cualquier servicio, sin importar
    // su especialidad, así que aquí se listan TODAS las del personal.
    supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre')
      .then(({ data }) => setEmpleadas(data ?? []))
  }, [])

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Servicio[]>()
    for (const s of servicios) {
      const lista = mapa.get(s.categoria) ?? []
      lista.push(s)
      mapa.set(s.categoria, lista)
    }
    return [...mapa.entries()]
  }, [servicios])

  const nombreServicios = (c: Cita): string[] => {
    const ids = c.servicios_ids && c.servicios_ids.length > 0 ? c.servicios_ids : c.servicio_id ? [c.servicio_id] : []
    return ids.map((id) => servicios.find((s) => s.id === id)?.nombre ?? c.servicio?.nombre ?? 'Servicio')
  }

  function agregarServicio() {
    if (!servicioTemp || serviciosIds.includes(servicioTemp)) return
    setServiciosIds((prev) => [...prev, servicioTemp])
    setServicioTemp('')
  }

  // Búsqueda en vivo de clientas por nombre o cédula.
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nombre, telefono, cedula')
        .eq('rol', 'cliente')
        .or(`nombre.ilike.%${q}%,cedula.ilike.%${q}%`)
        .order('nombre')
        .limit(8)
      setResultados((data as ClienteLite[]) ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda])

  function seleccionarCliente(r: ClienteLite) {
    setClienteId(r.id)
    setClienteNombre(r.nombre)
    setClienteTelefono(r.telefono ?? '')
    setCedula(r.cedula ?? '')
    setInfoCedula(`✓ Clienta seleccionada: ${r.nombre}`)
    setBusqueda('')
    setResultados([])
  }

  // Crea la clienta con su cédula (usuario y contraseña = cédula) y la enlaza.
  async function crearClientePorCedula() {
    const ced = cedula.trim()
    if (ced.length < 6) { setInfoCedula('La cédula debe tener al menos 6 dígitos.'); return }
    if (!clienteNombre.trim()) { setInfoCedula('Escribe el nombre de la clienta.'); return }
    setBuscando(true); setInfoCedula(null)
    const efimero = crearClienteEfimero()
    const { data, error } = await efimero.auth.signUp({
      email: `${ced}@${DOMINIO_INTERNO}`,
      password: ced,
      options: { data: { nombre: clienteNombre, telefono: clienteTelefono, cedula: ced } }
    })
    setBuscando(false)
    if (error) {
      setInfoCedula(
        error.message.toLowerCase().includes('registered') || error.message.toLowerCase().includes('already')
          ? 'Esa cédula ya tiene cuenta. Usa "Buscar" para traerla.'
          : 'No se pudo crear la clienta: ' + error.message
      )
      return
    }
    if (data.user?.id) {
      setClienteId(data.user.id)
      setInfoCedula(`✓ Clienta creada: ${clienteNombre}. Entrará con su cédula.`)
    }
  }

  async function crearCita(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    // Si eligió un servicio pero no le dio "Agregar", lo incluimos igual.
    const lista = servicioTemp && !serviciosIds.includes(servicioTemp) ? [...serviciosIds, servicioTemp] : serviciosIds
    if (lista.length === 0) { setError('Elige al menos un servicio.'); return }
    if (horaFin <= hora) { setError('La hora de término debe ser después de la hora de inicio.'); return }
    setError(null)

    // Si hay profesional elegida, verificar que no tenga cruce en ese horario.
    if (empleadaId) {
      const { data: libres } = await supabase.rpc('profesionales_disponibles', {
        p_fecha: fechaCita, p_desde: hora, p_hasta: horaFin
      })
      const disponible = ((libres as { id: string }[]) ?? []).some((p) => p.id === empleadaId)
      if (!disponible) {
        setError('Esa profesional ya tiene una cita en ese horario. Elige otra hora u otra profesional (o déjala sin asignar).')
        return
      }
    }

    setGuardando(true)

    const { data, error } = await supabase
      .from('citas')
      .insert({
        empleada_id: empleadaId || null,
        servicio_id: lista[0],
        servicios_ids: lista,
        cliente_id: clienteId,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono || null,
        fecha: fechaCita,
        hora,
        hora_fin: horaFin,
        abono: Number(abono || 0),
        abono_metodo_pago: Number(abono || 0) > 0 && abonoMetodo ? abonoMetodo : null,
        obsequio: obsequio || null,
        creado_por: profile.id
      })
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .single()

    setGuardando(false)
    if (error) {
      setError('No se pudo agendar la cita: ' + error.message)
      return
    }

    setUltimaCreada(data as Cita)
    setEmpleadaId('')
    setServiciosIds([])
    setServicioTemp('')
    setCedula('')
    setClienteId(null)
    setInfoCedula(null)
    setBusqueda('')
    setResultados([])
    setClienteNombre('')
    setClienteTelefono('')
    setHora('')
    setHoraFin('')
    setAbono('')
    setAbonoMetodo('')
    setObsequio('')
    if ((data as Cita).fecha === fecha) cargarCitas()
  }

  async function cambiarEstado(cita: Cita, estado: EstadoCita) {
    await supabase.from('citas').update({ estado }).eq('id', cita.id)
    cargarCitas()
  }

  // Confirmar abre WhatsApp con el mensaje listo para que la dueña lo revise
  // y lo envíe. Se abre ANTES del await para que el navegador no lo bloquee.
  function confirmarConWhatsApp(cita: Cita) {
    window.open(linkWhatsApp(cita, nombreServicios(cita)), '_blank')
    cambiarEstado(cita, 'confirmada')
  }

  async function asignarManicurista(cita: Cita, empId: string) {
    if (!empId) return
    await supabase.from('citas').update({ empleada_id: empId }).eq('id', cita.id)
    cargarCitas()
  }

  async function copiarMensaje(cita: Cita) {
    await navigator.clipboard.writeText(mensajeCita(cita, nombreServicios(cita)))
  }

  // Abre la foto del comprobante del abono en una pestaña nueva (URL firmada, 5 min).
  async function verComprobante(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Citas</h1>

      <form onSubmit={crearCita} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agendar nueva cita</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Profesional (opcional)</label>
          <select value={empleadaId} onChange={(e) => setEmpleadaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Sin asignar (se asigna después)</option>
            {empleadas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Servicios</label>
          {serviciosIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {serviciosIds.map((id) => {
                const s = servicios.find((x) => x.id === id)
                return (
                  <span key={id} className="inline-flex items-center gap-1 text-xs bg-brand-100 text-brand-700 rounded-full px-2 py-1">
                    {s?.nombre ?? 'Servicio'}
                    <button type="button" onClick={() => setServiciosIds((p) => p.filter((x) => x !== id))} className="text-brand-500">✕</button>
                  </span>
                )
              })}
            </div>
          )}
          <div className="flex gap-2">
            <select value={servicioTemp} onChange={(e) => setServicioTemp(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona un servicio</option>
              {porCategoria.map(([categoria, lista]) => (
                <optgroup key={categoria} label={categoria}>
                  {lista.map((s) => (
                    <option key={s.id} value={s.id} disabled={serviciosIds.includes(s.id)}>{s.nombre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" onClick={agregarServicio} disabled={!servicioTemp} className="px-3 rounded-lg border border-brand-300 text-brand-700 disabled:opacity-40 text-sm font-medium">
              Agregar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha</label>
            <input type="date" required value={fechaCita} onChange={(e) => setFechaCita(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora inicio</label>
            <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora término</label>
            <input type="time" required value={horaFin} onChange={(e) => setHoraFin(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        <div className="relative">
          <label className="block text-sm font-medium mb-1">Buscar clienta (nombre o cédula)</label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribe el nombre o la cédula…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          {resultados.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow max-h-56 overflow-y-auto">
              {resultados.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => seleccionarCliente(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 border-b border-gray-50 last:border-0"
                >
                  {r.nombre} <span className="text-gray-400">· {r.cedula ?? 'sin cédula'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Clienta {clienteId && <span className="text-green-600 text-xs">(registrada)</span>}</label>
            <input required value={clienteNombre} onChange={(e) => { setClienteNombre(e.target.value); setClienteId(null) }} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cédula</label>
            <input inputMode="numeric" value={cedula} onChange={(e) => { setCedula(e.target.value); setClienteId(null) }} placeholder="Documento" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono (para WhatsApp)</label>
            <input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div className="flex items-end">
            {!clienteId && cedula.trim() && clienteNombre.trim() && (
              <button type="button" onClick={crearClientePorCedula} disabled={buscando} className="w-full border border-brand-300 text-brand-700 rounded-lg py-2 text-sm font-medium disabled:opacity-40">
                {buscando ? 'Creando…' : 'Crear clienta con esta cédula'}
              </button>
            )}
          </div>
        </div>
        {infoCedula && (
          <p className={`text-xs -mt-1 ${infoCedula.startsWith('✓') ? 'text-green-700' : 'text-amber-700'}`}>{infoCedula}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Abono</label>
            <input type="number" min="0" step="0.01" value={abono} onChange={(e) => setAbono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Medio de pago del abono</label>
            <select
              value={abonoMetodo}
              onChange={(e) => setAbonoMetodo(e.target.value)}
              disabled={!(Number(abono || 0) > 0)}
              required={Number(abono || 0) > 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{Number(abono || 0) > 0 ? 'Selecciona…' : '(sin abono)'}</option>
              {METODOS_PAGO.map((m) => (
                <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Obsequio (opcional, según disponibilidad)</label>
          <select value={obsequio} onChange={(e) => setObsequio(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Sin obsequio</option>
            {OBSEQUIOS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <button type="submit" disabled={guardando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {guardando ? 'Agendando…' : 'Agendar cita'}
        </button>
      </form>

      {ultimaCreada && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm text-brand-700 font-medium">Cita agendada. Envíala por WhatsApp:</p>
          <pre className="text-xs bg-white rounded-lg p-3 whitespace-pre-wrap border border-brand-100">{mensajeCita(ultimaCreada, nombreServicios(ultimaCreada))}</pre>
          <div className="flex gap-2">
            <a
              href={linkWhatsApp(ultimaCreada, nombreServicios(ultimaCreada))}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg py-2 transition"
            >
              Enviar por WhatsApp
            </a>
            <button
              onClick={() => copiarMensaje(ultimaCreada)}
              className="flex-1 text-center bg-white border border-gray-300 text-sm font-medium rounded-lg py-2 transition"
            >
              Copiar mensaje
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-600">Agenda</h2>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      </div>

      {ORDEN_ESTADOS.map((est) => {
        const grupo = citas.filter((c) => c.estado === est)
        if (grupo.length === 0) return null
        return (
          <div key={est} className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{ETIQUETA_ESTADO[est]} ({grupo.length})</h3>
            <ul className="space-y-3">
              {grupo.map((c) => (
                <li key={c.id} className="bg-white rounded-2xl shadow p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">
                        {c.hora.slice(0, 5)}{c.hora_fin ? `–${c.hora_fin.slice(0, 5)}` : ''} · {nombreServicios(c).join(', ')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {c.empleada?.nombre ?? 'Sin asignar'} · {c.cliente_nombre}
                      </p>
                      {c.nota && <p className="text-xs text-gray-400">{c.nota}</p>}
                      {c.obsequio && <p className="text-xs text-brand-600">Obsequio: {c.obsequio}</p>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILOS[c.estado]}`}>{c.estado}</span>
                  </div>

                  {!c.empleada_id && c.estado !== 'cancelada' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                      <label className="block text-xs font-medium text-amber-800 mb-1">Asignar profesional</label>
                      <select
                        defaultValue=""
                        onChange={(e) => asignarManicurista(c, e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="" disabled>Selecciona una profesional</option>
                        {empleadas.map((e) => (
                          <option key={e.id} value={e.id}>{e.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      Abono: ${Number(c.abono).toLocaleString('es-CO')}{c.abono_metodo_pago ? ` (${c.abono_metodo_pago})` : ''}
                      {c.abono_foto_url && (
                        <button onClick={() => verComprobante(c.abono_foto_url!)} className="ml-2 text-xs text-brand-600 underline">
                          Ver comprobante
                        </button>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <a href={linkWhatsApp(c, nombreServicios(c))} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 underline">WhatsApp</a>
                      {c.estado === 'pendiente' && (
                        <button onClick={() => confirmarConWhatsApp(c)} className="text-xs text-blue-700 underline">Confirmar</button>
                      )}
                      {c.estado !== 'completada' && c.estado !== 'cancelada' && (
                        <button onClick={() => cambiarEstado(c, 'completada')} className="text-xs text-green-700 underline">Completar</button>
                      )}
                      {c.estado !== 'cancelada' && c.estado !== 'completada' && (
                        <button onClick={() => cambiarEstado(c, 'cancelada')} className="text-xs text-red-600 underline">Cancelar</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {citas.length === 0 && <p className="text-sm text-gray-400">No hay citas agendadas este día.</p>}
    </div>
  )
}
