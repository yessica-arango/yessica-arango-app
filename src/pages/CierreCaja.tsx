import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import type { RegistroTrabajo } from '../types'

export default function CierreCaja() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(inicioDeHoy())
  const [efectivo, setEfectivo] = useState('')
  const [nequi, setNequi] = useState('')
  const [daviplata, setDaviplata] = useState('')
  const [datafono, setDatafono] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Resumen de trabajos completados del día
  const [trabajos, setTrabajos] = useState<RegistroTrabajo[]>([])
  useEffect(() => {
    const { desde, hasta } = rangoDiaUTC(fecha)
    supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .eq('anulado', false)
      .order('created_at')
      .then(({ data }) => setTrabajos((data as RegistroTrabajo[]) ?? []))
  }, [fecha])
  const totalTrabajos = trabajos.reduce((s, t) => s + Number(t.precio_cobrado), 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      fecha,
      administradora_id: profile.id,
      efectivo_entregado: Number(efectivo || 0),
      nequi_reportado: Number(nequi || 0),
      daviplata_reportado: Number(daviplata || 0),
      datafono_reportado: Number(datafono || 0),
      observaciones: observaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de caja para esta fecha.'
          : 'No se pudo guardar el cierre de caja.'
      )
    } else {
      setMensaje('Cierre de caja guardado.')
      setEfectivo('')
      setNequi('')
      setDaviplata('')
      setDatafono('')
      setObservaciones('')
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Cierre de caja</h1>

      {/* Resumen: todos los trabajos completados del día */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-600">Trabajos completados del día</h2>
          <span className="text-sm font-semibold text-brand-700">Total: ${totalTrabajos.toLocaleString('es-CO')}</span>
        </div>
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {trabajos.map((t) => (
            <li key={t.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
              <span className="min-w-0 truncate">{t.empleada?.nombre} · {t.servicio?.nombre} · {t.cliente_nombre || 'Sin nombre'}</span>
              <span className="font-medium shrink-0">${Number(t.precio_cobrado).toLocaleString('es-CO')}</span>
            </li>
          ))}
          {trabajos.length === 0 && <li className="text-sm text-gray-400">Sin trabajos registrados este día.</li>}
        </ul>
        <p className="text-xs text-gray-400 mt-2">Compara este total con lo que efectivamente recibiste y repórtalo abajo por medio de pago.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-4 space-y-4">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Efectivo</label>
            <input
              type="number" min="0" step="0.01" required
              value={efectivo}
              onChange={(e) => setEfectivo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Nequi</label>
            <input
              type="number" min="0" step="0.01"
              value={nequi}
              onChange={(e) => setNequi(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Daviplata</label>
            <input
              type="number" min="0" step="0.01"
              value={daviplata}
              onChange={(e) => setDaviplata(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Datáfono</label>
            <input
              type="number" min="0" step="0.01"
              value={datafono}
              onChange={(e) => setDatafono(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <p className="text-sm font-medium text-brand-700">
          Total reportado: ${(Number(efectivo || 0) + Number(nequi || 0) + Number(daviplata || 0) + Number(datafono || 0)).toLocaleString('es-CO')}
        </p>

        <div>
          <label className="block text-sm font-medium mb-1">Observaciones</label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
            rows={3}
          />
        </div>

        <p className="text-xs text-gray-400">
          Este cierre no se puede editar ni borrar después de guardado. Si te equivocaste, crea uno nuevo
          explicando el motivo en observaciones — la dueña verá ambos.
        </p>

        <button
          type="submit"
          disabled={guardando}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
        >
          {guardando ? 'Guardando…' : 'Guardar cierre de caja'}
        </button>
      </form>
    </div>
  )
}
