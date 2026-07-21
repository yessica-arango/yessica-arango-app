import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { Cita, EstadoCita, Servicio } from '../types'

import { fechaHoy as hoy } from '../lib/fechas'

const ESTADO_TEXTO: Record<EstadoCita, string> = {
  pendiente: 'En espera de confirmación',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada'
}

const ESTADO_ESTILOS: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-blue-100 text-blue-700',
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-gray-200 text-gray-500'
}

export default function PortalCliente() {
  const { profile, signOut } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [hora, setHora] = useState('')
  const [nota, setNota] = useState('')
  const [misCitas, setMisCitas] = useState<Cita[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
      .then(({ data }) => setServicios(data ?? []))
  }, [])

  async function cargarMisCitas() {
    if (!profile) return
    const { data } = await supabase
      .from('citas')
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .eq('cliente_id', profile.id)
      .order('fecha', { ascending: false })
      .order('hora')
    setMisCitas((data as Cita[]) ?? [])
  }

  useEffect(() => {
    cargarMisCitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Servicio[]>()
    for (const s of servicios) {
      const lista = mapa.get(s.categoria) ?? []
      lista.push(s)
      mapa.set(s.categoria, lista)
    }
    return [...mapa.entries()]
  }, [servicios])

  function agregarServicio() {
    if (!servicioTemp || serviciosIds.includes(servicioTemp)) return
    setServiciosIds((prev) => [...prev, servicioTemp])
    setServicioTemp('')
  }

  async function solicitar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    const lista = servicioTemp && !serviciosIds.includes(servicioTemp) ? [...serviciosIds, servicioTemp] : serviciosIds
    if (lista.length === 0) { setError('Elige al menos un servicio.'); return }
    setError(null)
    setMensaje(null)
    setGuardando(true)

    const { error } = await supabase.from('citas').insert({
      servicio_id: lista[0],
      servicios_ids: lista,
      cliente_id: profile.id,
      cliente_nombre: profile.nombre,
      cliente_telefono: profile.telefono,
      fecha,
      hora,
      nota: nota || null,
      empleada_id: null,
      abono: 0,
      creado_por: profile.id
    })
    setGuardando(false)

    if (error) {
      setError('No se pudo enviar la solicitud: ' + error.message)
      return
    }
    setMensaje('¡Solicitud enviada! El salón la confirmará y te asignará una manicurista.')
    setServiciosIds([])
    setServicioTemp('')
    setHora('')
    setNota('')
    cargarMisCitas()
  }

  return (
    <div className="min-h-screen">
      <header className="bg-brand-50/90 backdrop-blur border-b border-brand-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="flex items-center gap-2 min-w-0">
          <img src="/icon-192.png" alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold text-brand-700 truncate">Yessica Arango</span>
            <span className="block text-[10px] uppercase tracking-wider text-brand-500 truncate">Nail &amp; Beauty Experts</span>
          </span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{profile?.nombre}</span>
          <button onClick={signOut} className="text-gray-400 hover:text-red-500">Salir</button>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Hola, {profile?.nombre} 💗</h1>
          <p className="text-sm text-gray-500">Solicita tu cita y el salón te confirmará.</p>
        </div>

        <form onSubmit={solicitar} className="bg-white rounded-2xl shadow p-4 space-y-3">
          {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
          {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">¿Qué servicios quieres?</label>
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
                      <option key={s.id} value={s.id} disabled={serviciosIds.includes(s.id)}>{s.nombre} — ${Number(s.precio_base).toLocaleString('es-CO')}</option>
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
              <label className="block text-sm font-medium mb-1">Fecha deseada</label>
              <input type="date" required min={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hora deseada</label>
              <input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Algún detalle que quieras contarnos" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>

          <button type="submit" disabled={guardando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
            {guardando ? 'Enviando…' : 'Solicitar cita'}
          </button>
        </form>

        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Mis citas</h2>
          <ul className="space-y-2">
            {misCitas.map((c) => (
              <li key={c.id} className="bg-white rounded-xl shadow-sm p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.servicio?.nombre}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILOS[c.estado]}`}>{ESTADO_TEXTO[c.estado]}</span>
                </div>
                <p className="text-gray-500 text-xs mt-1">
                  {c.fecha} · {c.hora.slice(0, 5)}
                  {c.empleada?.nombre ? ` · con ${c.empleada.nombre}` : ' · manicurista por asignar'}
                </p>
              </li>
            ))}
            {misCitas.length === 0 && <li className="text-sm text-gray-400">Aún no has solicitado citas.</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
