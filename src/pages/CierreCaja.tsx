import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

function inicioDeHoy() {
  return new Date().toISOString().slice(0, 10)
}

export default function CierreCaja() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(inicioDeHoy())
  const [efectivo, setEfectivo] = useState('')
  const [transferencias, setTransferencias] = useState('')
  const [tarjeta, setTarjeta] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      transferencias_reportadas: Number(transferencias || 0),
      tarjeta_reportada: Number(tarjeta || 0),
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
      setTransferencias('')
      setTarjeta('')
      setObservaciones('')
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-lg font-semibold mb-4">Cierre de caja</h1>
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

        <div>
          <label className="block text-sm font-medium mb-1">Efectivo entregado</label>
          <input
            type="number" min="0" step="0.01" required
            value={efectivo}
            onChange={(e) => setEfectivo(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Transferencias reportadas</label>
          <input
            type="number" min="0" step="0.01"
            value={transferencias}
            onChange={(e) => setTransferencias(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tarjeta reportada</label>
          <input
            type="number" min="0" step="0.01"
            value={tarjeta}
            onChange={(e) => setTarjeta(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

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
