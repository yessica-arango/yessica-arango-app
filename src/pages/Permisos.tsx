import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy } from '../lib/fechas'
import type { EstadoPermiso, Permiso } from '../types'

const ESTADO_ESTILO: Record<EstadoPermiso, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  aprobado: 'bg-green-100 text-green-700',
  rechazado: 'bg-gray-200 text-gray-500'
}

export default function Permisos() {
  const { profile } = useAuth()
  const esGestor = profile?.rol === 'admin' || profile?.rol === 'superadmin'

  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [desde, setDesde] = useState(fechaHoy())
  const [hasta, setHasta] = useState(fechaHoy())
  const [motivo, setMotivo] = useState('')
  const [tipo, setTipo] = useState<'permiso' | 'descanso'>('permiso')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    // El gestor ve todos; el personal solo los suyos (lo aplica el RLS).
    const query = supabase
      .from('permisos')
      .select('*, persona:profiles!permisos_persona_id_fkey(nombre)')
      .order('fecha_desde', { ascending: false })
    const { data } = await query
    setPermisos((data as Permiso[]) ?? [])
  }

  useEffect(() => {
    cargar()
  }, [])

  async function solicitar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null); setMensaje(null)
    if (hasta < desde) { setError('La fecha final no puede ser antes de la inicial.'); return }

    const esDescanso = esGestor && tipo === 'descanso'
    const { error } = await supabase.from('permisos').insert({
      persona_id: profile.id,
      tipo: esDescanso ? 'descanso' : 'permiso',
      fecha_desde: desde,
      fecha_hasta: hasta,
      motivo: motivo || null,
      estado: esDescanso ? 'aprobado' : 'pendiente',
      creado_por: profile.id
    })
    if (error) { setError('No se pudo registrar: ' + error.message); return }
    setMensaje(esDescanso ? 'Descanso registrado.' : 'Solicitud enviada. Queda pendiente de aprobación.')
    setMotivo('')
    cargar()
  }

  async function resolver(id: string, estado: EstadoPermiso) {
    await supabase.from('permisos').update({ estado }).eq('id', id)
    cargar()
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Permisos y descansos</h1>

      <form onSubmit={solicitar} className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-600">
          {esGestor ? 'Registrar permiso o descanso' : 'Solicitar permiso'}
        </h2>
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        {esGestor && (
          <div>
            <label className="block text-sm font-medium mb-1">Tipo (para ti)</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as 'permiso' | 'descanso')} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="permiso">Permiso (queda pendiente)</option>
              <option value="descanso">Mi día de descanso (queda aprobado)</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Desde</label>
            <input type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hasta</label>
            <input type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Motivo (opcional)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          {esGestor && tipo === 'descanso' ? 'Registrar descanso' : 'Enviar solicitud'}
        </button>
      </form>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">
          {esGestor ? 'Todas las solicitudes' : 'Mis solicitudes'}
        </h2>
        <ul className="space-y-2">
          {permisos.map((p) => (
            <li key={p.id} className="bg-white rounded-xl shadow-sm p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {esGestor && <span>{p.persona?.nombre} · </span>}
                  {p.tipo === 'descanso' ? 'Descanso' : 'Permiso'}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILO[p.estado]}`}>{p.estado}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {p.fecha_desde}{p.fecha_hasta !== p.fecha_desde ? ` al ${p.fecha_hasta}` : ''}
                {p.motivo ? ` · ${p.motivo}` : ''}
              </p>
              {esGestor && p.estado === 'pendiente' && p.tipo === 'permiso' && (
                <div className="flex gap-3 mt-2">
                  <button onClick={() => resolver(p.id, 'aprobado')} className="text-xs text-green-700 underline">Aprobar</button>
                  <button onClick={() => resolver(p.id, 'rechazado')} className="text-xs text-red-600 underline">Rechazar</button>
                </div>
              )}
            </li>
          ))}
          {permisos.length === 0 && <li className="text-sm text-gray-400">Sin solicitudes.</li>}
        </ul>
      </div>
    </div>
  )
}
