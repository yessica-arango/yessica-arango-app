import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Cita, type ComisionPago, type Profile, type RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5 // a las especialistas se les paga el 50%

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

// Comisiones por especialista + abonos registrados, en un rango de fechas.
// Se usa tanto en Reportes (admin) como en la subpestaña de Contabilidad
// (superadmin), para no repetir la misma información en dos pantallas.
// El admin operativo no debe ver cuánto gana/debe cada profesional (eso es
// información de nómina, reservada a la dueña) — solo el resumen de abonos.
export default function ComisionesAbonos({ ocultarComisiones = false }: { ocultarComisiones?: boolean }) {
  const { profile } = useAuth()
  const [desde, setDesde] = useState(haceDias(14))
  const [hasta, setHasta] = useState(hoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [abonos, setAbonos] = useState<Cita[]>([])
  const [deudas, setDeudas] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)

  // Saldo pendiente de comisión: persistente (todo el histórico trabajado,
  // sin importar el rango de fechas de arriba) menos lo que ya se le pagó —
  // igual patrón que "Prestado pendiente" en Préstamos, pero al revés.
  const [personal, setPersonal] = useState<Profile[]>([])
  const [registrosTodos, setRegistrosTodos] = useState<{ empleada_id: string; precio_cobrado: number }[]>([])
  const [comisionPagos, setComisionPagos] = useState<ComisionPago[]>([])
  const [pagandoId, setPagandoId] = useState<string | null>(null)
  const [montoPago, setMontoPago] = useState('')
  const [metodoPago, setMetodoPago] = useState('')
  const [notaPago, setNotaPago] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)

  async function cargarSaldos() {
    const [{ data: pers }, { data: regs }, { data: pagos }] = await Promise.all([
      supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre'),
      supabase.from('registros_trabajo').select('empleada_id, precio_cobrado').eq('anulado', false),
      supabase.from('comision_pagos').select('*')
    ])
    setPersonal((pers as Profile[]) ?? [])
    setRegistrosTodos((regs as { empleada_id: string; precio_cobrado: number }[]) ?? [])
    setComisionPagos((pagos as ComisionPago[]) ?? [])
  }

  useEffect(() => {
    if (!ocultarComisiones) cargarSaldos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocultarComisiones])

  const saldosComision = useMemo(() => {
    const ganadoPorPersona = new Map<string, number>()
    for (const r of registrosTodos) {
      ganadoPorPersona.set(r.empleada_id, (ganadoPorPersona.get(r.empleada_id) ?? 0) + Number(r.precio_cobrado) * PORCENTAJE_COMISION)
    }
    const pagadoPorPersona = new Map<string, number>()
    for (const p of comisionPagos) {
      pagadoPorPersona.set(p.persona_id, (pagadoPorPersona.get(p.persona_id) ?? 0) + Number(p.monto))
    }
    return personal
      .map((p) => {
        const ganado = ganadoPorPersona.get(p.id) ?? 0
        const pagado = pagadoPorPersona.get(p.id) ?? 0
        return { id: p.id, nombre: p.nombre, ganado, pagado, saldo: Math.max(0, ganado - pagado) }
      })
      .filter((s) => s.ganado > 0)
      .sort((a, b) => b.saldo - a.saldo)
  }, [personal, registrosTodos, comisionPagos])

  function abrirPago(id: string, saldo: number) {
    setPagandoId(id)
    setMontoPago(String(Math.round(saldo)))
    setMetodoPago('')
    setNotaPago('')
    setPagoError(null)
  }

  async function confirmarPago(e: FormEvent, s: { id: string; saldo: number }) {
    e.preventDefault()
    if (!profile) return
    setPagoError(null)
    const valor = Number(montoPago)
    if (!valor || valor <= 0) { setPagoError('Escribe el monto pagado.'); return }
    if (valor > s.saldo + 0.01) { setPagoError('Ese monto es mayor al saldo pendiente.'); return }
    setGuardandoPago(true)
    const { error } = await supabase.from('comision_pagos').insert({
      persona_id: s.id,
      monto: valor,
      metodo_pago: metodoPago || null,
      nota: notaPago || null,
      pagado_por: profile.id
    })
    setGuardandoPago(false)
    if (error) { setPagoError('No se pudo registrar el pago: ' + error.message); return }
    setPagandoId(null)
    cargarSaldos()
  }

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(desde, hasta)
      const [{ data: regs }, { data: cits }, { data: prest }, { data: pagosPrest }] = await Promise.all([
        supabase
          .from('registros_trabajo')
          .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
          .gte('created_at', rango.desde)
          .lt('created_at', rango.hasta)
          .eq('anulado', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('citas')
          .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
          .gt('abono', 0)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false }),
        // Préstamos NO saldados manualmente (deuda actual), sin importar el rango de fechas.
        supabase.from('prestamos').select('id, persona_id, monto').eq('pagado', false),
        // Pagos ya recibidos de esos préstamos, para descontarlos del saldo.
        supabase.from('prestamo_pagos').select('prestamo_id, monto')
      ])
      if (!cancelado) {
        setRegistros((regs as RegistroTrabajo[]) ?? [])
        setAbonos((cits as Cita[]) ?? [])
        const pagadoPorPrestamo = new Map<string, number>()
        for (const pg of (pagosPrest as { prestamo_id: string; monto: number }[]) ?? []) {
          pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
        }
        const m = new Map<string, number>()
        for (const p of (prest as { id: string; persona_id: string; monto: number }[]) ?? []) {
          const pendiente = Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0))
          if (pendiente <= 0) continue
          m.set(p.persona_id, (m.get(p.persona_id) ?? 0) + pendiente)
        }
        setDeudas(m)
        setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [desde, hasta])

  const comisiones = useMemo(() => {
    const mapa = new Map<string, { id: string; nombre: string; cantidad: number; total: number }>()
    for (const r of registros) {
      const id = r.empleada?.id ?? 'sin'
      const nombre = r.empleada?.nombre ?? 'Sin asignar'
      const a = mapa.get(id) ?? { id, nombre, cantidad: 0, total: 0 }
      a.cantidad += 1
      a.total += Number(r.precio_cobrado)
      mapa.set(id, a)
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total)
  }, [registros])

  const totalServicios = comisiones.reduce((s, c) => s + c.total, 0)
  const totalComision = totalServicios * PORCENTAJE_COMISION
  const totalDeuda = comisiones.reduce((s, c) => s + (deudas.get(c.id) ?? 0), 0)
  const totalNeto = comisiones.reduce((s, c) => s + Math.max(0, c.total * PORCENTAJE_COMISION - (deudas.get(c.id) ?? 0)), 0)
  const totalAbonos = abonos.reduce((s, c) => s + Number(c.abono), 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => { setDesde(haceDias(6)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última semana</button>
          <button onClick={() => { setDesde(haceDias(14)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última quincena</button>
        </div>
      </div>

      {/* Saldo pendiente de comisión: histórico completo, no depende del rango de arriba. Solo dueña. */}
      {!ocultarComisiones && saldosComision.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold text-sm text-gray-600 mb-1">Comisión pendiente por pagar</h2>
          <p className="text-xs text-gray-400 mb-3">Todo lo trabajado históricamente, menos lo que ya se le pagó — sin importar el rango de fechas de arriba.</p>
          <ul className="space-y-2">
            {saldosComision.map((s) => (
              <li key={s.id} className="border-b border-gray-50 pb-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{s.nombre}</span>
                  <span className={`text-sm font-semibold ${s.saldo > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {s.saldo > 0 ? pesos(s.saldo) : 'Al día'}
                  </span>
                </div>
                {s.saldo > 0 && pagandoId !== s.id && (
                  <button onClick={() => abrirPago(s.id, s.saldo)} className="text-xs text-brand-600 font-medium mt-1">
                    Confirmar valor y pagar
                  </button>
                )}
                {pagandoId === s.id && (
                  <form onSubmit={(e) => confirmarPago(e, s)} className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                    {pagoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{pagoError}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Monto pagado</label>
                        <input
                          type="text" inputMode="numeric"
                          value={formatearPesosInput(montoPago)}
                          onChange={(e) => setMontoPago(soloDigitos(e.target.value))}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Medio de pago (opcional)</label>
                        <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                          <option value="">Selecciona…</option>
                          {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                        </select>
                      </div>
                    </div>
                    <input
                      value={notaPago}
                      onChange={(e) => setNotaPago(e.target.value)}
                      placeholder="Nota (opcional)"
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-2">
                      <button type="submit" disabled={guardandoPago} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5">
                        {guardandoPago ? 'Guardando…' : 'Registrar pago'}
                      </button>
                      <button type="button" onClick={() => setPagandoId(null)} className="px-3 text-sm text-gray-500">
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {/* Comisiones (solo dueña: es información de nómina) */}
          {!ocultarComisiones && (
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold text-sm text-gray-600 mb-1">Comisiones por especialista (50%)</h2>
            <p className="text-xs text-gray-400 mb-3">Del {desde} al {hasta}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-2">Especialista</th>
                    <th className="py-2 px-1 text-right">Serv.</th>
                    <th className="py-2 px-1 text-right">50%</th>
                    <th className="py-2 px-1 text-right">Debe</th>
                    <th className="py-2 pl-1 text-right">Le pagas</th>
                  </tr>
                </thead>
                <tbody>
                  {comisiones.map((c) => {
                    const comision = c.total * PORCENTAJE_COMISION
                    const debe = deudas.get(c.id) ?? 0
                    const neto = Math.max(0, comision - debe)
                    return (
                      <tr key={c.id} className="border-b border-gray-50">
                        <td className="py-2 pr-2 font-medium">{c.nombre}</td>
                        <td className="py-2 px-1 text-right">{c.cantidad}</td>
                        <td className="py-2 px-1 text-right">{pesos(comision)}</td>
                        <td className="py-2 px-1 text-right text-red-600">{debe > 0 ? '-' + pesos(debe) : '—'}</td>
                        <td className="py-2 pl-1 text-right font-semibold text-brand-700">{pesos(neto)}</td>
                      </tr>
                    )
                  })}
                  {comisiones.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-gray-400">Sin servicios en este rango.</td></tr>
                  )}
                </tbody>
                {comisiones.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="py-2 pr-2">Total</td>
                      <td className="py-2 px-1 text-right">{comisiones.reduce((s, c) => s + c.cantidad, 0)}</td>
                      <td className="py-2 px-1 text-right">{pesos(totalComision)}</td>
                      <td className="py-2 px-1 text-right text-red-600">{totalDeuda > 0 ? '-' + pesos(totalDeuda) : '—'}</td>
                      <td className="py-2 pl-1 text-right text-brand-700">{pesos(totalNeto)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          )}

          {/* Abonos */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm text-gray-600">Abonos registrados</h2>
              <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalAbonos)}</span>
            </div>
            <ul className="space-y-2">
              {abonos.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                  <div>
                    <p className="font-medium">{c.cliente_nombre} <span className="text-gray-400 font-normal">· {c.servicio?.nombre}</span></p>
                    <p className="text-xs text-gray-400">
                      {c.fecha} · {c.abono_metodo_pago ?? 'sin medio'} · {c.estado}
                    </p>
                  </div>
                  <span className="font-semibold">{pesos(Number(c.abono))}</span>
                </li>
              ))}
              {abonos.length === 0 && <li className="text-sm text-gray-400">Sin abonos en este rango.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
