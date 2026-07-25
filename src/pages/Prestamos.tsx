import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { METODOS_PAGO, type Prestamo, type Profile, type TipoPrestamo } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function Prestamos() {
  const { profile } = useAuth()
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [personal, setPersonal] = useState<Profile[]>([])

  const [personaId, setPersonaId] = useState('')
  const [tipo, setTipo] = useState<TipoPrestamo>('dinero')
  const [descripcion, setDescripcion] = useState('')
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase
      .from('prestamos')
      .select('*, persona:profiles!prestamos_persona_id_fkey(nombre)')
      .order('created_at', { ascending: false })
    setPrestamos((data as Prestamo[]) ?? [])
  }

  useEffect(() => {
    cargar()
    supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre')
      .then(({ data }) => setPersonal((data as Profile[]) ?? []))
  }, [])

  async function registrar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null); setMensaje(null)
    const { error } = await supabase.from('prestamos').insert({
      persona_id: personaId,
      tipo,
      descripcion: descripcion || null,
      monto: Number(monto || 0),
      metodo_pago: metodoPago || null,
      creado_por: profile.id
    })
    if (error) { setError('No se pudo registrar: ' + error.message); return }
    setMensaje('Registrado.')
    setPersonaId(''); setTipo('dinero'); setDescripcion(''); setMonto(''); setMetodoPago('')
    cargar()
  }

  async function alternarPagado(p: Prestamo) {
    await supabase.from('prestamos').update({ pagado: !p.pagado }).eq('id', p.id)
    cargar()
  }

  const porPersona = useMemo(() => {
    const mapa = new Map<string, { nombre: string; pendiente: number }>()
    for (const p of prestamos) {
      if (p.pagado) continue
      const nombre = p.persona?.nombre ?? 'Sin nombre'
      const a = mapa.get(p.persona_id) ?? { nombre, pendiente: 0 }
      a.pendiente += Number(p.monto)
      mapa.set(p.persona_id, a)
    }
    return [...mapa.values()].filter((x) => x.pendiente > 0)
  }, [prestamos])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Préstamos e insumos fiados</h1>

      <form onSubmit={registrar} className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-600">Registrar préstamo / fiado</h2>
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Persona</label>
            <select required value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona…</option>
              {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPrestamo)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="dinero">Préstamo de dinero</option>
              <option value="insumo">Insumo fiado</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Descripción</label>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder={tipo === 'insumo' ? 'Ej: labial, esmalte…' : 'Ej: adelanto'} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monto</label>
            <input type="number" min="0" step="0.01" required value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">¿Por qué medio se dio?</label>
            <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona…</option>
              {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">Registrar</button>
      </form>

      {porPersona.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Deben (pendiente)</h2>
          <ul className="space-y-1">
            {porPersona.map((x) => (
              <li key={x.nombre} className="flex justify-between text-sm">
                <span>{x.nombre}</span>
                <span className="font-semibold text-red-600">{pesos(x.pendiente)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Historial</h2>
        <ul className="space-y-2">
          {prestamos.map((p) => (
            <li key={p.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm flex items-center justify-between ${p.pagado ? 'opacity-60' : ''}`}>
              <div className="min-w-0">
                <p className="font-medium">{p.persona?.nombre} · {p.tipo === 'insumo' ? 'Insumo' : 'Dinero'}</p>
                <p className="text-xs text-gray-400 truncate">{p.descripcion || '—'}{p.metodo_pago ? ` · ${p.metodo_pago}` : ''} · {p.created_at.slice(0, 10)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-semibold ${p.pagado ? 'line-through text-gray-400' : ''}`}>{pesos(Number(p.monto))}</span>
                <button onClick={() => alternarPagado(p)} className={`text-xs px-2 py-1 rounded-full ${p.pagado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {p.pagado ? 'Pagado' : 'Pendiente'}
                </button>
              </div>
            </li>
          ))}
          {prestamos.length === 0 && <li className="text-sm text-gray-400">Sin registros.</li>}
        </ul>
      </div>
    </div>
  )
}
