import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as hoy, fechaLocal, haceDias, rangoUTC } from '../lib/fechas'
import type { RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function MiComision() {
  const { profile } = useAuth()
  const [rangoDias, setRangoDias] = useState<7 | 15>(7)
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!profile) return
    let cancelado = false
    setCargando(true)
    const desde = haceDias(rangoDias - 1)
    const hasta = hoy()
    const rango = rangoUTC(desde, hasta)
    supabase
      .from('registros_trabajo')
      .select('*')
      .eq('empleada_id', profile.id)
      .eq('anulado', false)
      .gte('created_at', rango.desde)
      .lt('created_at', rango.hasta)
      .order('created_at')
      .then(({ data }) => {
        if (!cancelado) {
          setRegistros((data as RegistroTrabajo[]) ?? [])
          setCargando(false)
        }
      })
    return () => { cancelado = true }
  }, [profile, rangoDias])

  // Agrupa por día local y arma un total que se va acumulando día a día.
  const dias = useMemo(() => {
    const porDia = new Map<string, { cantidad: number; total: number }>()
    for (const r of registros) {
      const dia = fechaLocal(new Date(r.created_at))
      const d = porDia.get(dia) ?? { cantidad: 0, total: 0 }
      d.cantidad += 1
      d.total += Number(r.precio_cobrado)
      porDia.set(dia, d)
    }
    let acumulado = 0
    return [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, d]) => {
        const comision = d.total * PORCENTAJE_COMISION
        acumulado += comision
        return { fecha, cantidad: d.cantidad, total: d.total, comision, acumulado }
      })
  }, [registros])

  const totalTrabajado = dias.reduce((s, d) => s + d.total, 0)
  const totalComision = dias.reduce((s, d) => s + d.comision, 0)

  if (!profile) return null

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mi comisión</h1>
        <div className="flex gap-1 bg-white/70 rounded-xl p-1 shadow-sm">
          <button
            onClick={() => setRangoDias(7)}
            className={`text-xs font-medium rounded-lg py-1.5 px-3 transition ${rangoDias === 7 ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
          >
            7 días
          </button>
          <button
            onClick={() => setRangoDias(15)}
            className={`text-xs font-medium rounded-lg py-1.5 px-3 transition ${rangoDias === 15 ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
          >
            15 días
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-600">Por día ({PORCENTAJE_COMISION * 100}% de lo trabajado)</h2>
          <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalComision)}</span>
        </div>

        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-2">Día</th>
                  <th className="py-2 px-1 text-right">Serv.</th>
                  <th className="py-2 px-1 text-right">Trabajado</th>
                  <th className="py-2 px-1 text-right">{PORCENTAJE_COMISION * 100}%</th>
                  <th className="py-2 pl-1 text-right">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((d) => (
                  <tr key={d.fecha} className="border-b border-gray-50">
                    <td className="py-2 pr-2">{d.fecha}</td>
                    <td className="py-2 px-1 text-right">{d.cantidad}</td>
                    <td className="py-2 px-1 text-right">{pesos(d.total)}</td>
                    <td className="py-2 px-1 text-right font-medium">{pesos(d.comision)}</td>
                    <td className="py-2 pl-1 text-right font-semibold text-brand-700">{pesos(d.acumulado)}</td>
                  </tr>
                ))}
                {dias.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-gray-400">Sin servicios en este rango.</td></tr>
                )}
              </tbody>
              {dias.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 font-semibold">
                    <td className="py-2 pr-2">Total</td>
                    <td className="py-2 px-1 text-right">{dias.reduce((s, d) => s + d.cantidad, 0)}</td>
                    <td className="py-2 px-1 text-right">{pesos(totalTrabajado)}</td>
                    <td className="py-2 px-1 text-right">{pesos(totalComision)}</td>
                    <td className="py-2 pl-1 text-right text-brand-700">{pesos(totalComision)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Esto es una guía de lo que llevas trabajado — la administración puede descontar préstamos o insumos antes de pagarte (revisa "Mi perfil").
        </p>
      </div>
    </div>
  )
}
