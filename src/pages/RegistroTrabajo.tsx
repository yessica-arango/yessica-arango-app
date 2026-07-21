import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import type { RegistroTrabajo, Servicio } from '../types'

interface Linea {
  key: string
  servicioId: string
  servicioNombre: string
  precioBase: number
  descuento: number
  total: number
  nota: string | null
}

export default function RegistroTrabajoPage() {
  const { profile } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])

  // Línea que se está agregando
  const [servicioId, setServicioId] = useState('')
  const [precio, setPrecio] = useState('')
  const [descuento, setDescuento] = useState('0')
  const [notaLinea, setNotaLinea] = useState('')

  // Carrito de servicios de esta misma clienta
  const [lineas, setLineas] = useState<Linea[]>([])

  // Datos compartidos
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [misRegistrosHoy, setMisRegistrosHoy] = useState<RegistroTrabajo[]>([])

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
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

  const servicioSel = servicios.find((s) => s.id === servicioId)
  const esAdicional = servicioSel?.categoria === 'Adicional'
  const base = Number(precio) || 0
  const desc = Number(descuento) || 0
  const totalLinea = Math.max(0, Math.round(base * (1 - desc / 100)))
  const notaRequerida = esAdicional || desc > 0
  const etiquetaNota = esAdicional ? 'Concepto del adicional' : desc > 0 ? 'Motivo del descuento' : 'Nota (opcional)'

  const totalGeneral = lineas.reduce((s, l) => s + l.total, 0)

  function handleServicioChange(id: string) {
    setServicioId(id)
    const s = servicios.find((x) => x.id === id)
    if (s) setPrecio(String(s.precio_base))
  }

  function agregarLinea(): boolean {
    if (!servicioId) { setError('Elige un servicio.'); return false }
    if (notaRequerida && !notaLinea.trim()) {
      setError(esAdicional ? 'Escribe el concepto del adicional.' : 'Escribe el motivo del descuento.')
      return false
    }
    setError(null)
    setLineas((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        servicioId,
        servicioNombre: servicioSel?.nombre ?? 'Servicio',
        precioBase: base,
        descuento: desc,
        total: totalLinea,
        nota: notaLinea.trim() || null
      }
    ])
    setServicioId('')
    setPrecio('')
    setDescuento('0')
    setNotaLinea('')
    return true
  }

  function quitarLinea(key: string) {
    setLineas((prev) => prev.filter((l) => l.key !== key))
  }

  async function cargarRegistrosHoy() {
    if (!profile) return
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    const { data } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', profile.id)
      .gte('created_at', desde)
      .lt('created_at', hasta)
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

    // Si dejó una línea escrita sin haberla agregado al carrito, la incluimos.
    const items = [...lineas]
    if (servicioId) {
      if (notaRequerida && !notaLinea.trim()) {
        setError(esAdicional ? 'Escribe el concepto del adicional.' : 'Escribe el motivo del descuento.')
        return
      }
      items.push({
        key: 'actual', servicioId, servicioNombre: servicioSel?.nombre ?? '', precioBase: base,
        descuento: desc, total: totalLinea, nota: notaLinea.trim() || null
      })
    }
    if (items.length === 0) { setError('Agrega al menos un servicio.'); return }

    setGuardando(true)
    try {
      let fotoUrl: string | null = null
      if (foto) {
        const path = `${profile.id}/${Date.now()}_${foto.name}`
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, foto)
        if (upErr) throw upErr
        fotoUrl = path
      }

      const filas = items.map((l) => ({
        empleada_id: profile.id,
        servicio_id: l.servicioId,
        precio_cobrado: l.total,
        descuento_porcentaje: l.descuento,
        cliente_nombre: clienteNombre || null,
        cliente_telefono: clienteTelefono || null,
        nota: l.nota,
        foto_url: fotoUrl
      }))

      const { error: insErr } = await supabase.from('registros_trabajo').insert(filas)
      if (insErr) throw insErr

      setMensaje(`Se registraron ${filas.length} servicio(s).`)
      setLineas([])
      setServicioId('')
      setPrecio('')
      setDescuento('0')
      setNotaLinea('')
      setClienteNombre('')
      setClienteTelefono('')
      setFoto(null)
      cargarRegistrosHoy()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar.')
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

        {/* Datos de la clienta (compartidos por todos los servicios) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (nombre)</label>
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono</label>
            <input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        {/* Carrito de servicios */}
        {lineas.length > 0 && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-2 space-y-1">
            {lineas.map((l) => (
              <div key={l.key} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2">
                <span className="min-w-0">
                  {l.servicioNombre}
                  {l.descuento > 0 && <span className="text-brand-500"> (-{l.descuento}%)</span>}
                  {l.nota && <span className="text-gray-400"> · {l.nota}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-medium">${l.total.toLocaleString('es-CO')}</span>
                  <button type="button" onClick={() => quitarLinea(l.key)} className="text-red-500 text-xs">Quitar</button>
                </span>
              </div>
            ))}
            <p className="text-right text-sm font-semibold text-brand-700 pt-1">Total: ${totalGeneral.toLocaleString('es-CO')}</p>
          </div>
        )}

        {/* Agregar un servicio */}
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-sm font-medium mb-1">Servicio</label>
            <select value={servicioId} onChange={(e) => handleServicioChange(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona un servicio</option>
              {porCategoria.map(([categoria, lista]) => (
                <optgroup key={categoria} label={categoria}>
                  {lista.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Precio</label>
              <input type="number" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descuento (%)</label>
              <input type="number" min="0" max="100" step="1" value={descuento} onChange={(e) => setDescuento(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          {desc > 0 && (
            <p className="text-sm text-brand-700 font-medium -mt-1">Con {desc}% queda en ${totalLinea.toLocaleString('es-CO')}</p>
          )}

          {(notaRequerida || servicioId) && (
            <div>
              <label className="block text-sm font-medium mb-1">{etiquetaNota}</label>
              <input
                value={notaLinea}
                onChange={(e) => setNotaLinea(e.target.value)}
                placeholder={esAdicional ? 'Ej: diseño personalizado' : desc > 0 ? 'Ej: promoción' : ''}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => agregarLinea()}
            disabled={!servicioId}
            className="w-full border border-brand-300 text-brand-700 disabled:opacity-40 font-medium rounded-lg py-2"
          >
            + Agregar servicio
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Foto de evidencia (opcional)</label>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-sm" />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
        >
          {guardando ? 'Guardando…' : `Registrar ${lineas.length + (servicioId ? 1 : 0) || ''} trabajo(s)`}
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
