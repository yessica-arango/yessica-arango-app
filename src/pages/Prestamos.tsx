import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { METODOS_PAGO, type Prestamo, type PrestamoPago, type Profile, type TipoPrestamo } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function Prestamos() {
  const { profile } = useAuth()
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [pagos, setPagos] = useState<PrestamoPago[]>([])
  const [personal, setPersonal] = useState<Profile[]>([])

  const [personaId, setPersonaId] = useState('')
  const [tipo, setTipo] = useState<TipoPrestamo>('dinero')
  const [descripcion, setDescripcion] = useState('')
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Registrar pago (abono) de un préstamo, con su propio medio de pago.
  const [pagandoId, setPagandoId] = useState<string | null>(null)
  const [montoPago, setMontoPago] = useState('')
  const [metodoPagoAbono, setMetodoPagoAbono] = useState('')
  const [notaPago, setNotaPago] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)

  async function cargar() {
    const [{ data: prest }, { data: pagosData }] = await Promise.all([
      supabase
        .from('prestamos')
        .select('*, persona:profiles!prestamos_persona_id_fkey(nombre)')
        .order('created_at', { ascending: false }),
      supabase.from('prestamo_pagos').select('*').order('created_at', { ascending: false })
    ])
    setPrestamos((prest as Prestamo[]) ?? [])
    setPagos((pagosData as PrestamoPago[]) ?? [])
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

  const pagosPorPrestamo = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pagos) m.set(p.prestamo_id, (m.get(p.prestamo_id) ?? 0) + Number(p.monto))
    return m
  }, [pagos])

  function pendienteDe(p: Prestamo): number {
    if (p.pagado) return 0
    return Math.max(0, Number(p.monto) - (pagosPorPrestamo.get(p.id) ?? 0))
  }

  function abrirPago(p: Prestamo) {
    setPagandoId(p.id)
    setMontoPago(String(pendienteDe(p)))
    setMetodoPagoAbono('')
    setNotaPago('')
    setPagoError(null)
  }

  // Para cuando la deuda se salda descontándola de la comisión (no entra
  // dinero nuevo a caja, así que no se registra en el ledger de pagos).
  async function marcarSaldadoSinCaja(p: Prestamo) {
    if (!confirm(`¿Confirmas que ya se descontó ${pesos(pendienteDe(p))} de la comisión de ${p.persona?.nombre}? Esto no queda registrado en el cierre de caja.`)) return
    await supabase.from('prestamos').update({ pagado: true }).eq('id', p.id)
    cargar()
  }

  async function registrarPago(p: Prestamo) {
    if (!profile) return
    setPagoError(null)
    const valor = Number(montoPago)
    if (!valor || valor <= 0) { setPagoError('Escribe el monto pagado.'); return }
    if (valor > pendienteDe(p) + 0.01) { setPagoError('Ese monto es mayor a lo pendiente.'); return }
    if (!metodoPagoAbono) { setPagoError('Elige el medio de pago.'); return }
    setGuardandoPago(true)
    const { error } = await supabase.from('prestamo_pagos').insert({
      prestamo_id: p.id,
      monto: valor,
      metodo_pago: metodoPagoAbono,
      nota: notaPago || null,
      pagado_por: profile.id
    })
    setGuardandoPago(false)
    if (error) { setPagoError('No se pudo registrar: ' + error.message); return }
    setPagandoId(null)
    cargar()
  }

  const porPersona = useMemo(() => {
    const mapa = new Map<string, { nombre: string; pendiente: number }>()
    for (const p of prestamos) {
      const pend = pendienteDe(p)
      if (pend <= 0) continue
      const nombre = p.persona?.nombre ?? 'Sin nombre'
      const a = mapa.get(p.persona_id) ?? { nombre, pendiente: 0 }
      a.pendiente += pend
      mapa.set(p.persona_id, a)
    }
    return [...mapa.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prestamos, pagosPorPrestamo])

  const totalPrestado = useMemo(
    () => prestamos.reduce((s, p) => s + pendienteDe(p), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prestamos, pagosPorPrestamo]
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Préstamos e insumos fiados</h1>

      {totalPrestado > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Prestado (pendiente de pago)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestado)}</p>
        </div>
      )}

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
          {prestamos.map((p) => {
            const pendiente = pendienteDe(p)
            const pagosDeEste = pagos.filter((pg) => pg.prestamo_id === p.id)
            return (
              <li key={p.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm space-y-2 ${pendiente <= 0 ? 'opacity-70' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.persona?.nombre} · {p.tipo === 'insumo' ? 'Insumo' : 'Dinero'}</p>
                    <p className="text-xs text-gray-400 truncate">{p.descripcion || '—'}{p.metodo_pago ? ` · ${p.metodo_pago}` : ''} · {p.created_at.slice(0, 10)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-semibold">{pesos(Number(p.monto))}</span>
                    {pendiente <= 0 ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Pagado</span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">Debe {pesos(pendiente)}</span>
                    )}
                  </div>
                </div>

                {pagosDeEste.length > 0 && (
                  <ul className="text-xs text-green-700 space-y-0.5 pl-1">
                    {pagosDeEste.map((pg) => (
                      <li key={pg.id}>✓ {pesos(Number(pg.monto))} en {METODOS_PAGO.find((m) => m.valor === pg.metodo_pago)?.etiqueta}{pg.nota ? ` · ${pg.nota}` : ''}</li>
                    ))}
                  </ul>
                )}

                {pendiente > 0 && pagandoId !== p.id && (
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => abrirPago(p)} className="text-xs text-brand-600 font-medium">
                      Registrar pago ▾
                    </button>
                    {p.tipo === 'dinero' && (
                      <button onClick={() => marcarSaldadoSinCaja(p)} className="text-xs text-gray-400 font-medium">
                        Ya se descontó de su comisión
                      </button>
                    )}
                  </div>
                )}

                {pagandoId === p.id && (
                  <div className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-2">
                    {pagoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{pagoError}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Monto pagado</label>
                        <input type="number" min="0.01" step="0.01" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Medio de pago</label>
                        <select value={metodoPagoAbono} onChange={(e) => setMetodoPagoAbono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                          <option value="">Selecciona…</option>
                          {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                        </select>
                      </div>
                    </div>
                    <input placeholder="Nota (opcional)" value={notaPago} onChange={(e) => setNotaPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={() => registrarPago(p)} disabled={guardandoPago} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5">
                        {guardandoPago ? 'Guardando…' : 'Registrar pago'}
                      </button>
                      <button onClick={() => setPagandoId(null)} className="px-3 text-sm text-gray-500">Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
          {prestamos.length === 0 && <li className="text-sm text-gray-400">Sin registros.</li>}
        </ul>
      </div>
    </div>
  )
}
