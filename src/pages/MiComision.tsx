import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import type { RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' })
}

// Lo que la profesional lleva trabajado HOY. A propósito no muestra
// acumulados de varios días ni el saldo pendiente de comisión: cuánto se le
// debe en total y cuándo se le paga lo maneja la dueña en Contabilidad.
export default function MiComision() {
  const { profile } = useAuth()
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!profile) return
    let cancelado = false
    setCargando(true)
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', profile.id)
      .eq('anulado', false)
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at')
      .then(({ data }) => {
        if (!cancelado) {
          setRegistros((data as RegistroTrabajo[]) ?? [])
          setCargando(false)
        }
      })
    return () => { cancelado = true }
  }, [profile])

  const totalTrabajado = registros.reduce((s, r) => s + Number(r.precio_cobrado), 0)
  const totalComision = totalTrabajado * PORCENTAJE_COMISION

  if (!profile) return null

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Lo que llevo hoy</h1>

      <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xs text-gray-400">Trabajado hoy</p>
          <p className="text-xl font-bold">{pesos(totalTrabajado)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Tu {PORCENTAJE_COMISION * 100}% de hoy</p>
          <p className="text-xl font-bold text-brand-700">{pesos(totalComision)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="text-sm font-semibold text-gray-600 mb-3">Servicios de hoy</h2>
        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <ul className="space-y-1">
            {registros.map((r) => (
              <li key={r.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                <span className="min-w-0 truncate">
                  {horaLocal(r.created_at)} · {r.servicio?.nombre}
                  {r.cliente_nombre ? ` · ${r.cliente_nombre}` : ''}
                </span>
                <span className="font-medium shrink-0">{pesos(Number(r.precio_cobrado))}</span>
              </li>
            ))}
            {registros.length === 0 && <li className="text-sm text-gray-400">Todavía no has registrado trabajos hoy.</li>}
          </ul>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Es solo lo de hoy. Lo que se te debe en total y cuándo se paga lo maneja la administración —
          si tienes dudas, pregúntale a la dueña.
        </p>
      </div>
    </div>
  )
}
