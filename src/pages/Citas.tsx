import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { linkWhatsApp, mensajeCita } from '../lib/whatsapp'
import { METODOS_PAGO, type Cita, type EstadoCita, type Profile, type Servicio } from '../types'

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

const ESTADO_ESTILOS: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-blue-100 text-blue-700',
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-gray-200 text-gray-500'
}

export default function Citas() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(hoy())
  const [citas, setCitas] = useState<Cita[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [empleadas, setEmpleadas] = useState<Profile[]>([])

  const [empleadaId, setEmpleadaId] = useState('')
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [fechaCita, setFechaCita] = useState(hoy())
  const [hora, setHora] = useState('')
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

  async function crearCita(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (serviciosIds.length === 0) { setError('Agrega al menos un servicio.'); return }
    setError(null)
    setGuardando(true)

    const { data, error } = await supabase
      .from('citas')
      .insert({
        empleada_id: empleadaId,
        servicio_id: serviciosIds[0],
        servicios_ids: serviciosIds,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono || null,
        fecha: fechaCita,
        hora,
        abono: Number(abono || 0),
        abono_metodo_pago: Number(abono || 0) > 0 && abonoMetodo ? abonoMetodo : null,
        obsequio: obsequio || null,
        creado_por: profile.id
      })
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .single()

    setGuardando(false)
    if (error) {
      setError('No se pudo agendar la cita.')
      return
    }

    setUltimaCreada(data as Cita)
    setEmpleadaId('')
    setServiciosIds([])
    setServicioTemp('')
    setClienteNombre('')
    setClienteTelefono('')
    setHora('')
    setAbono('')
    setAbonoMetodo('')
    setObsequio('')
    if ((data as Cita).fecha === fecha) cargarCitas()
  }

  async function cambiarEstado(cita: Cita, estado: EstadoCita) {
    await supabase.from('citas').update({ estado }).eq('id', cita.id)
    cargarCitas()
  }

  async function asignarManicurista(cita: Cita, empId: string) {
    if (!empId) return
    await supabase.from('citas').update({ empleada_id: empId }).eq('id', cita.id)
    cargarCitas()
  }

  async function copiarMensaje(cita: Cita) {
    await navigator.clipboard.writeText(mensajeCita(cita, nombreServicios(cita)))
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Citas</h1>

      <form onSubmit={crearCita} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agendar nueva cita</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Profesional</label>
          <select required value={empleadaId} onChange={(e) => setEmpleadaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="" disabled>Selecciona una profesional</option>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha</label>
            <input type="date" required value={fechaCita} onChange={(e) => setFechaCita(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora</label>
            <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Clienta</label>
            <input required value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono (para WhatsApp)</label>
            <input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

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
          <label className="block text-sm font-medium mb-1">Obsequio (opcional)</label>
          <input value={obsequio} onChange={(e) => setObsequio(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
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

      <ul className="space-y-3">
        {citas.map((c) => (
          <li key={c.id} className="bg-white rounded-2xl shadow p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-sm">{c.hora.slice(0, 5)} · {nombreServicios(c).join(', ')}</p>
                <p className="text-xs text-gray-500">
                  {c.empleada?.nombre ?? 'Sin asignar'} · {c.cliente_nombre}
                </p>
                {c.nota && <p className="text-xs text-gray-400">📝 {c.nota}</p>}
                {c.obsequio && <p className="text-xs text-brand-600">🎁 {c.obsequio}</p>}
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
              <p className="text-sm font-medium">Abono: ${Number(c.abono).toLocaleString('es-CO')}{c.abono_metodo_pago ? ` (${c.abono_metodo_pago})` : ''}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <a href={linkWhatsApp(c, nombreServicios(c))} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 underline">
                  WhatsApp
                </a>
                {c.estado === 'pendiente' && (
                  <button onClick={() => cambiarEstado(c, 'confirmada')} className="text-xs text-blue-700 underline">Confirmar</button>
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
        {citas.length === 0 && <li className="text-sm text-gray-400">No hay citas agendadas este día.</li>}
      </ul>
    </div>
  )
}
