import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy } from '../lib/fechas'
import type { EstadoPermiso, Permiso, Profile } from '../types'

const ESTADO_ESTILO: Record<EstadoPermiso, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  aprobado: 'bg-green-100 text-green-700',
  rechazado: 'bg-gray-200 text-gray-500'
}

export default function Permisos() {
  const { profile } = useAuth()
  const esSuper = profile?.rol === 'superadmin'
  const esGestor = profile?.rol === 'admin' || esSuper

  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [personal, setPersonal] = useState<Profile[]>([])

  const [personaId, setPersonaId] = useState('') // solo superadmin: para quién
  const [tipo, setTipo] = useState<'permiso' | 'descanso'>('permiso')
  const [desde, setDesde] = useState(fechaHoy())
  const [hasta, setHasta] = useState(fechaHoy())
  const [horaDesde, setHoraDesde] = useState('')
  const [horaHasta, setHoraHasta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Corrección de un permiso/descanso ya registrado (solo superadmin).
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editTipo, setEditTipo] = useState<'permiso' | 'descanso'>('permiso')
  const [editDesde, setEditDesde] = useState('')
  const [editHasta, setEditHasta] = useState('')
  const [editHoraDesde, setEditHoraDesde] = useState('')
  const [editHoraHasta, setEditHoraHasta] = useState('')
  const [editMotivo, setEditMotivo] = useState('')
  const [editEstado, setEditEstado] = useState<EstadoPermiso>('pendiente')
  const [editError, setEditError] = useState<string | null>(null)
  const [guardandoEdit, setGuardandoEdit] = useState(false)
  const [borrandoId, setBorrandoId] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase
      .from('permisos')
      .select('*, persona:profiles!permisos_persona_id_fkey(nombre)')
      .order('fecha_desde', { ascending: false })
    setPermisos((data as Permiso[]) ?? [])
  }

  useEffect(() => {
    cargar()
    if (esSuper) {
      supabase.from('profiles').select('*').in('rol', ['personal', 'admin']).eq('activo', true).order('nombre')
        .then(({ data }) => setPersonal((data as Profile[]) ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSuper])

  async function solicitar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null); setMensaje(null)
    if (hasta < desde) { setError('La fecha final no puede ser antes de la inicial.'); return }
    if (!esSuper && !motivo.trim()) { setError('Escribe el motivo para poder enviar la solicitud.'); return }

    // El superadmin registra para quien elija (o para sí mismo) y queda aprobado.
    // Los demás solicitan para sí mismos y queda pendiente.
    const paraId = esSuper && personaId ? personaId : profile.id
    const esRegistroSuper = esSuper
    const { error } = await supabase.from('permisos').insert({
      persona_id: paraId,
      tipo: esSuper ? tipo : 'permiso',
      fecha_desde: desde,
      fecha_hasta: hasta,
      hora_desde: horaDesde || null,
      hora_hasta: horaHasta || null,
      motivo: motivo || null,
      estado: esRegistroSuper ? 'aprobado' : 'pendiente',
      creado_por: profile.id
    })
    if (error) { setError('No se pudo registrar: ' + error.message); return }
    setMensaje(esRegistroSuper ? 'Registrado.' : 'Solicitud enviada. Queda pendiente de aprobación.')
    setMotivo(''); setHoraDesde(''); setHoraHasta(''); setPersonaId('')
    cargar()
  }

  async function resolver(id: string, estado: EstadoPermiso) {
    await supabase.from('permisos').update({ estado }).eq('id', id)
    cargar()
  }

  function abrirEditar(p: Permiso) {
    setEditandoId(p.id)
    setEditTipo(p.tipo)
    setEditDesde(p.fecha_desde)
    setEditHasta(p.fecha_hasta)
    setEditHoraDesde(p.hora_desde ? p.hora_desde.slice(0, 5) : '')
    setEditHoraHasta(p.hora_hasta ? p.hora_hasta.slice(0, 5) : '')
    setEditMotivo(p.motivo ?? '')
    setEditEstado(p.estado)
    setEditError(null)
  }

  async function guardarEdicion(e: FormEvent, id: string) {
    e.preventDefault()
    setEditError(null)
    if (editHasta < editDesde) { setEditError('La fecha final no puede ser antes de la inicial.'); return }
    setGuardandoEdit(true)
    const { error } = await supabase.from('permisos').update({
      tipo: editTipo,
      fecha_desde: editDesde,
      fecha_hasta: editHasta,
      hora_desde: editHoraDesde || null,
      hora_hasta: editHoraHasta || null,
      motivo: editMotivo || null,
      estado: editEstado
    }).eq('id', id)
    setGuardandoEdit(false)
    if (error) { setEditError('No se pudo guardar: ' + error.message); return }
    setEditandoId(null)
    cargar()
  }

  async function borrarPermiso(p: Permiso) {
    const tipoTexto = p.tipo === 'descanso' ? 'descanso' : 'permiso'
    if (!confirm(`¿Borrar este ${tipoTexto} de ${p.persona?.nombre ?? ''}? Esta acción no se puede deshacer.`)) return
    setBorrandoId(p.id)
    await supabase.from('permisos').delete().eq('id', p.id)
    setBorrandoId(null)
    cargar()
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Permisos y descansos</h1>

      <form onSubmit={solicitar} className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-600">
          {esSuper ? 'Registrar permiso o descanso' : 'Solicitar permiso'}
        </h2>
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        {esSuper && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">¿Para quién?</label>
              <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">Yo ({profile?.nombre})</option>
                {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as 'permiso' | 'descanso')} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="descanso">Día de descanso</option>
                <option value="permiso">Permiso</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Desde (fecha)</label>
            <input type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hasta (fecha)</label>
            <input type="date" required value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora desde (opcional)</label>
            <input type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora hasta (opcional)</label>
            <input type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Motivo{esSuper ? ' (opcional)' : ''}</label>
          <input
            required={!esSuper}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          {esSuper ? 'Registrar' : 'Enviar solicitud'}
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
                {p.hora_desde ? ` · ${p.hora_desde.slice(0, 5)}${p.hora_hasta ? ' a ' + p.hora_hasta.slice(0, 5) : ''}` : ''}
                {p.motivo ? ` · ${p.motivo}` : ''}
              </p>
              {esSuper && p.estado === 'pendiente' && editandoId !== p.id && (
                <div className="flex gap-3 mt-2">
                  <button onClick={() => resolver(p.id, 'aprobado')} className="text-xs text-green-700 underline">Aprobar</button>
                  <button onClick={() => resolver(p.id, 'rechazado')} className="text-xs text-red-600 underline">Rechazar</button>
                </div>
              )}
              {esSuper && editandoId !== p.id && (
                <div className="flex gap-3 mt-2">
                  <button onClick={() => abrirEditar(p)} className="text-xs text-brand-700 underline">Editar</button>
                  <button
                    onClick={() => borrarPermiso(p)}
                    disabled={borrandoId === p.id}
                    className="text-xs text-red-500 underline disabled:opacity-40"
                  >
                    Borrar
                  </button>
                </div>
              )}
              {esSuper && editandoId === p.id && (
                <form onSubmit={(e) => guardarEdicion(e, p.id)} className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                  {editError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{editError}</div>}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Tipo</label>
                      <select value={editTipo} onChange={(e) => setEditTipo(e.target.value as 'permiso' | 'descanso')} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                        <option value="descanso">Día de descanso</option>
                        <option value="permiso">Permiso</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Estado</label>
                      <select value={editEstado} onChange={(e) => setEditEstado(e.target.value as EstadoPermiso)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                        <option value="pendiente">Pendiente</option>
                        <option value="aprobado">Aprobado</option>
                        <option value="rechazado">Rechazado</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Desde</label>
                      <input type="date" required value={editDesde} onChange={(e) => setEditDesde(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Hasta</label>
                      <input type="date" required value={editHasta} onChange={(e) => setEditHasta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Hora desde</label>
                      <input type="time" value={editHoraDesde} onChange={(e) => setEditHoraDesde(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Hora hasta</label>
                      <input type="time" value={editHoraHasta} onChange={(e) => setEditHoraHasta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Motivo</label>
                    <input value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={guardandoEdit} className="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg py-1.5 transition disabled:opacity-50">
                      Guardar
                    </button>
                    <button type="button" onClick={() => setEditandoId(null)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg py-1.5 transition">
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
          {permisos.length === 0 && <li className="text-sm text-gray-400">Sin solicitudes.</li>}
        </ul>
      </div>
    </div>
  )
}
