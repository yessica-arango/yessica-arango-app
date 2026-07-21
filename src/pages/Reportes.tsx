import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Cita, RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5 // a las especialistas se les paga el 50%

function hoy() {
  return new Date().toISOString().slice(0, 10)
}
function haceDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function Reportes() {
  const [desde, setDesde] = useState(haceDias(14))
  const [hasta, setHasta] = useState(hoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [abonos, setAbonos] = useState<Cita[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const [{ data: regs }, { data: cits }] = await Promise.all([
        supabase
          .from('registros_trabajo')
          .select('*, servicio:servicios(*), empleada:profiles(*)')
          .gte('created_at', `${desde}T00:00:00`)
          .lt('created_at', `${hasta}T23:59:59.999`)
          .eq('anulado', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('citas')
          .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
          .gt('abono', 0)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false })
      ])
      if (!cancelado) {
        setRegistros((regs as RegistroTrabajo[]) ?? [])
        setAbonos((cits as Cita[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [desde, hasta])

  const comisiones = useMemo(() => {
    const mapa = new Map<string, { nombre: string; cantidad: number; total: number }>()
    for (const r of registros) {
      const nombre = r.empleada?.nombre ?? 'Sin asignar'
      const a = mapa.get(nombre) ?? { nombre, cantidad: 0, total: 0 }
      a.cantidad += 1
      a.total += Number(r.precio_cobrado)
      mapa.set(nombre, a)
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total)
  }, [registros])

  const totalServicios = comisiones.reduce((s, c) => s + c.total, 0)
  const totalComision = totalServicios * PORCENTAJE_COMISION
  const totalAbonos = abonos.reduce((s, c) => s + Number(c.abono), 0)

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Reportes</h1>

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

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {/* Comisiones */}
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold text-sm text-gray-600 mb-1">Comisiones por especialista (50%)</h2>
            <p className="text-xs text-gray-400 mb-3">Del {desde} al {hasta}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-2">Especialista</th>
                    <th className="py-2 px-2 text-right">Servicios</th>
                    <th className="py-2 px-2 text-right">Total</th>
                    <th className="py-2 pl-2 text-right">Le pagas (50%)</th>
                  </tr>
                </thead>
                <tbody>
                  {comisiones.map((c) => (
                    <tr key={c.nombre} className="border-b border-gray-50">
                      <td className="py-2 pr-2 font-medium">{c.nombre}</td>
                      <td className="py-2 px-2 text-right">{c.cantidad}</td>
                      <td className="py-2 px-2 text-right">{pesos(c.total)}</td>
                      <td className="py-2 pl-2 text-right font-semibold text-brand-700">{pesos(c.total * PORCENTAJE_COMISION)}</td>
                    </tr>
                  ))}
                  {comisiones.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-gray-400">Sin servicios en este rango.</td></tr>
                  )}
                </tbody>
                {comisiones.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="py-2 pr-2">Total</td>
                      <td className="py-2 px-2 text-right">{comisiones.reduce((s, c) => s + c.cantidad, 0)}</td>
                      <td className="py-2 px-2 text-right">{pesos(totalServicios)}</td>
                      <td className="py-2 pl-2 text-right text-brand-700">{pesos(totalComision)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

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
