import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import type { MetodoPago, RegistroTrabajo, Servicio } from '../types'

export default function RegistroTrabajoPage() {
  const { profile } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [servicioId, setServicioId] = useState('')
  const [precio, setPrecio] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [nota, setNota] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [misRegistrosHoy, setMisRegistrosHoy] = useState<RegistroTrabajo[]>([])

  useEffect(() => {
    supabase
      .from('servicios')
      .select('*')
      .eq('activo', true)
      .order('categoria')
      .order('nombre')
      .then(({ data }) => setServicios(data ?? []))
  }, [])

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Servicio[]>()
    for (const s of servicios) {
      const lista = mapa.get(s.categoria) ?? []
      lista.push(s)
      mapa.set(s.categoria, lista)
    }
    return [...mapa.entries()]
  }, [servicios])

  const servicioSeleccionado = servicios.find((s) => s.id === servicioId)
  const esAdicional = servicioSeleccionado?.categoria === 'Adicional'

  function handleServicioChange(id: string) {
    setServicioId(id)
    const s = servicios.find((x) => x.id === id)
    if (s) setPrecio(String(s.precio_base))
  }

  async function cargarRegistrosHoy() {
    if (!profile) return
    const hoy = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', profile.id)
      .gte('created_at', `${hoy}T00:00:00`)
      .order('created_at', { ascending: false })
    setMisRegistrosHoy((data as RegistroTrabajo[]) ?? [])
  }

  useEffect(() => {
    cargarRegistrosHoy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    setGuardando(true)

    try {
      let fotoUrl: string | null = null
      if (foto) {
        const path = `${profile.id}/${Date.now()}_${foto.name}`
        const { error: uploadError } = await supabase.storage
          .from('evidencias')
          .upload(path, foto)
        if (uploadError) throw uploadError
        fotoUrl = path
      }

      const { error: insertError } = await supabase.from('registros_trabajo').insert({
        empleada_id: profile.id,
        servicio_id: servicioId,
        precio_cobrado: Number(precio),
        metodo_pago: metodoPago,
        cliente_nombre: clienteNombre || null,
        cliente_telefono: clienteTelefono || null,
        nota: nota || null,
        foto_url: fotoUrl
      })
      if (insertError) throw insertError

      setMensaje('Trabajo registrado correctamente.')
      setServicioId('')
      setPrecio('')
      setClienteNombre('')
      setClienteTelefono('')
      setNota('')
      setFoto(null)
      cargarRegistrosHoy()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el trabajo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Registrar trabajo</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-4 space-y-4">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Servicio</label>
          <select
            required
            value={servicioId}
            onChange={(e) => handleServicioChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="" disabled>Selecciona un servicio</option>
            {porCategoria.map(([categoria, lista]) => (
              <optgroup key={categoria} label={categoria}>
                {lista.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Precio cobrado</label>
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Método de pago</label>
          <select
            value={metodoPago}
            onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (nombre)</label>
            <input
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono</label>
            <input
              value={clienteTelefono}
              onChange={(e) => setClienteTelefono(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {esAdicional ? 'Concepto del adicional' : 'Nota (opcional)'}
          </label>
          <input
            required={esAdicional}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={esAdicional ? 'Ej: esmaltado de diseño personalizado' : ''}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Foto de evidencia</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
        >
          {guardando ? 'Guardando…' : 'Registrar trabajo'}
        </button>
      </form>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Mis registros de hoy</h2>
        <ul className="space-y-2">
          {misRegistrosHoy.map((r) => (
            <li key={r.id} className="bg-white rounded-xl shadow-sm p-3 text-sm flex justify-between">
              <span>
                {r.servicio?.nombre ?? 'Servicio'} · {r.cliente_nombre || 'Sin nombre'}
                {r.nota && <span className="text-gray-400"> ({r.nota})</span>}
              </span>
              <span className={r.anulado ? 'line-through text-red-500' : 'font-medium'}>
                ${r.precio_cobrado.toLocaleString('es-CO')}
              </span>
            </li>
          ))}
          {misRegistrosHoy.length === 0 && (
            <li className="text-sm text-gray-400">Aún no has registrado trabajos hoy.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
