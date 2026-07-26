import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { METODOS_PAGO, type Producto, type Venta } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function Ventas() {
  const { profile } = useAuth()
  const [productos, setProductos] = useState<Producto[]>([])
  const [ventasHoy, setVentasHoy] = useState<Venta[]>([])

  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [clienteNombre, setClienteNombre] = useState('')
  const [metodoPago, setMetodoPago] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargarProductos() {
    const { data } = await supabase.from('productos').select('*').eq('activo', true).gt('stock', 0).order('nombre')
    setProductos((data as Producto[]) ?? [])
  }

  async function cargarVentasHoy() {
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    const { data } = await supabase
      .from('ventas')
      .select('*, producto:productos(*), vendedor:profiles!ventas_vendido_por_fkey(nombre)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at', { ascending: false })
    setVentasHoy((data as Venta[]) ?? [])
  }

  useEffect(() => {
    cargarProductos()
    cargarVentasHoy()
  }, [])

  const productoSel = productos.find((p) => p.id === productoId)
  const total = productoSel ? Math.round(Number(productoSel.precio_venta) * Number(cantidad || 0)) : 0

  async function registrarVenta(e: FormEvent) {
    e.preventDefault()
    if (!profile || !productoSel) return
    setError(null)
    setMensaje(null)
    const cant = Number(cantidad)
    if (!cant || cant <= 0) { setError('La cantidad debe ser mayor a 0.'); return }
    if (cant > productoSel.stock) { setError(`Solo hay ${productoSel.stock} en stock.`); return }
    if (!metodoPago) { setError('Elige el medio de pago.'); return }
    if (metodoPago !== 'efectivo' && !foto) { setError('Sube la foto del comprobante del pago.'); return }

    setGuardando(true)
    try {
      let fotoUrl: string | null = null
      if (foto) {
        const comprimida = await comprimirImagen(foto)
        const path = `ventas/${profile.id}/${Date.now()}_${comprimida.name}`
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
        if (upErr) throw upErr
        fotoUrl = path
      }

      const { error: insErr } = await supabase.from('ventas').insert({
        producto_id: productoSel.id,
        cantidad: cant,
        precio_unitario: productoSel.precio_venta,
        total,
        cliente_nombre: clienteNombre || null,
        metodo_pago: metodoPago,
        foto_url: fotoUrl,
        nota: nota || null,
        vendido_por: profile.id
      })
      if (insErr) throw insErr

      setMensaje(`Venta de ${cant} × ${productoSel.nombre} registrada.`)
      setProductoId(''); setCantidad('1'); setClienteNombre(''); setMetodoPago(''); setFoto(null); setNota('')
      cargarProductos()
      cargarVentasHoy()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
    } finally {
      setGuardando(false)
    }
  }

  async function anularVenta(v: Venta) {
    const motivo = prompt('¿Por qué se anula esta venta? (el producto vuelve al inventario)')
    if (motivo === null) return
    await supabase.from('ventas').update({
      anulado: true,
      motivo_anulacion: motivo || null,
      anulado_por: profile?.id,
      anulado_at: new Date().toISOString()
    }).eq('id', v.id)
    cargarProductos()
    cargarVentasHoy()
  }

  const totalHoy = useMemo(
    () => ventasHoy.filter((v) => !v.anulado).reduce((s, v) => s + Number(v.total), 0),
    [ventasHoy]
  )

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Ventas de vitrina</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Para cuando una clienta (o cualquiera) compra un producto de la vitrina, distinto del insumo
        fiado a una empleada (eso sigue siendo por Préstamos).
      </p>

      <form onSubmit={registrarVenta} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Producto</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Selecciona…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} — {pesos(p.precio_venta)} ({p.stock} en stock)</option>
            ))}
          </select>
          {productos.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No hay productos con stock disponible. Pídele a la dueña que los agregue en Inventario.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cantidad</label>
            <input
              type="number" min="1" step="1" required
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              max={productoSel?.stock}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (opcional)</label>
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        {productoSel && (
          <p className="text-sm font-semibold text-brand-700">Total: {pesos(total)}</p>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Medio de pago</label>
          <select required value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Selecciona…</option>
            {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Foto del pago {metodoPago && metodoPago !== 'efectivo' ? '(obligatoria)' : '(opcional en efectivo)'}
          </label>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" disabled={guardando || !productoId} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {guardando ? 'Guardando…' : 'Registrar venta'}
        </button>
      </form>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500">Ventas de hoy</h2>
          <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalHoy)}</span>
        </div>
        <ul className="space-y-2">
          {ventasHoy.map((v) => (
            <li key={v.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm ${v.anulado ? 'opacity-50' : ''}`}>
              <div className="flex justify-between">
                <span>
                  {v.cantidad} × {v.producto?.nombre ?? 'Producto'}
                  {v.cliente_nombre && <span className="text-gray-400"> · {v.cliente_nombre}</span>}
                  {v.anulado && <span className="text-red-500"> (anulada)</span>}
                </span>
                <span className={v.anulado ? 'line-through text-red-500' : 'font-medium'}>{pesos(Number(v.total))}</span>
              </div>
              <p className="text-xs text-gray-400">{v.vendedor?.nombre} · {v.metodo_pago}</p>
              {profile?.rol === 'superadmin' && !v.anulado && (
                <button onClick={() => anularVenta(v)} className="text-xs text-red-500 mt-1">Anular</button>
              )}
            </li>
          ))}
          {ventasHoy.length === 0 && <li className="text-sm text-gray-400">Aún no hay ventas hoy.</li>}
        </ul>
      </div>
    </div>
  )
}
