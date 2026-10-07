import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Producto, type Venta, type VentaPago } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

interface VentaConPagos extends Venta {
  pagos: VentaPago[]
}

// Una compra: puede llevar varios productos. Cada producto queda como una
// venta aparte en la base (para el stock y la anulación), pero todas
// comparten venta_grupo_id y acá se muestran juntas.
interface Compra {
  clave: string
  ventas: VentaConPagos[]
  total: number
  anulada: boolean
}

// Un producto puesto en el carrito, antes de registrar la venta.
interface LineaProducto {
  key: string
  productoId: string
  cantidad: number
}

export default function Ventas() {
  const { profile } = useAuth()
  const [productos, setProductos] = useState<Producto[]>([])
  const [ventasHoy, setVentasHoy] = useState<VentaConPagos[]>([])

  // Carrito: varios productos en una sola venta.
  const [carrito, setCarrito] = useState<LineaProducto[]>([])
  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('1')

  const [clienteNombre, setClienteNombre] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Pago del carrito: puede pagarse con varios medios (ej. mitad efectivo,
  // mitad Nequi) en un solo registro de venta.
  const [lineasPago, setLineasPago] = useState<{ key: string; metodo: string; monto: number; foto: File | null }[]>([])
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  async function cargarProductos() {
    const { data } = await supabase.from('productos').select('*').eq('tipo', 'vitrina').eq('activo', true).gt('stock', 0).order('nombre')
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
    const ventas = (data as Venta[]) ?? []
    const ids = ventas.map((v) => v.id)
    const { data: pagosData } = ids.length > 0
      ? await supabase.from('venta_pagos').select('*').in('venta_id', ids)
      : { data: [] as VentaPago[] }
    const pagos = (pagosData as VentaPago[]) ?? []
    setVentasHoy(ventas.map((v) => ({ ...v, pagos: pagos.filter((p) => p.venta_id === v.id) })))
  }

  useEffect(() => {
    cargarProductos()
    cargarVentasHoy()
  }, [])

  const productoDe = (id: string) => productos.find((p) => p.id === id)

  // Stock que queda libre de un producto, descontando lo que ya está en el
  // carrito (si no, se podrían agregar dos líneas del mismo y pasarse).
  function stockLibre(id: string) {
    const enCarrito = carrito.filter((l) => l.productoId === id).reduce((s, l) => s + l.cantidad, 0)
    return (productoDe(id)?.stock ?? 0) - enCarrito
  }

  const productoSel = productoDe(productoId)
  const cantidadSel = Number(cantidad || 0)
  const totalSuelto = productoSel ? Math.round(Number(productoSel.precio_venta) * cantidadSel) : 0
  const totalCarrito = carrito.reduce(
    (s, l) => s + Math.round(Number(productoDe(l.productoId)?.precio_venta ?? 0) * l.cantidad),
    0
  )
  const total = totalCarrito + totalSuelto

  const sumaLineas = lineasPago.reduce((s, l) => s + l.monto, 0) + (Number(monto) > 0 && metodo ? Number(monto) : 0)
  const faltaPorAsignar = total - sumaLineas

  function agregarProducto() {
    if (!productoSel) { setError('Elige el producto.'); return }
    if (!cantidadSel || cantidadSel <= 0) { setError('La cantidad debe ser mayor a 0.'); return }
    if (cantidadSel > stockLibre(productoSel.id)) {
      setError(`Solo quedan ${stockLibre(productoSel.id)} de ${productoSel.nombre}.`)
      return
    }
    setError(null)
    setCarrito((prev) => [...prev, { key: crypto.randomUUID(), productoId: productoSel.id, cantidad: cantidadSel }])
    setProductoId('')
    setCantidad('1')
  }

  function quitarProducto(key: string) {
    setCarrito((prev) => prev.filter((l) => l.key !== key))
  }

  function agregarLineaPago() {
    const valor = Number(monto)
    if (!valor || valor <= 0) { setError('Escribe el monto de este pago.'); return }
    if (!metodo) { setError('Elige el medio de pago.'); return }
    if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
    setError(null)
    setLineasPago((prev) => [...prev, { key: crypto.randomUUID(), metodo, monto: valor, foto }])
    setMonto('')
    setMetodo('')
    setFoto(null)
  }

  function quitarLineaPago(key: string) {
    setLineasPago((prev) => prev.filter((l) => l.key !== key))
  }

  async function registrarVenta(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)

    // Si eligió un producto pero no le dio "Agregar", lo incluimos igual.
    let productosVenta = carrito
    if (productoSel) {
      if (!cantidadSel || cantidadSel <= 0) { setError('La cantidad debe ser mayor a 0.'); return }
      productosVenta = [...carrito, { key: 'actual', productoId: productoSel.id, cantidad: cantidadSel }]
    }
    if (productosVenta.length === 0) { setError('Agrega al menos un producto.'); return }

    // Stock: se revisa el total pedido de cada producto, no línea por línea.
    const pedidoPorProducto = new Map<string, number>()
    for (const l of productosVenta) {
      pedidoPorProducto.set(l.productoId, (pedidoPorProducto.get(l.productoId) ?? 0) + l.cantidad)
    }
    for (const [id, cant] of pedidoPorProducto) {
      const p = productoDe(id)
      if (!p) { setError('Uno de los productos ya no está disponible. Vuelve a agregarlo.'); return }
      if (cant > p.stock) { setError(`Solo hay ${p.stock} de ${p.nombre} en stock.`); return }
    }

    // Si dejó un medio escrito sin agregarlo a la lista, lo incluimos igual.
    let lineas = lineasPago
    const valorSuelto = Number(monto)
    if (valorSuelto > 0 || metodo) {
      if (!valorSuelto || valorSuelto <= 0) { setError('Escribe el monto del pago.'); return }
      if (!metodo) { setError('Elige el medio de pago.'); return }
      if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
      lineas = [...lineasPago, { key: 'actual', metodo, monto: valorSuelto, foto }]
    }
    if (lineas.length === 0) { setError('Agrega el pago de esta venta.'); return }
    const sumaFinal = lineas.reduce((s, l) => s + l.monto, 0)
    const totalVenta = productosVenta.reduce(
      (s, l) => s + Math.round(Number(productoDe(l.productoId)?.precio_venta ?? 0) * l.cantidad),
      0
    )
    if (sumaFinal !== totalVenta) {
      setError(`Los pagos suman ${pesos(sumaFinal)}, pero el total es ${pesos(totalVenta)}. Ajusta los montos.`)
      return
    }

    setGuardando(true)
    try {
      // Las fotos se suben una sola vez, aunque ese pago se reparta entre
      // varios productos de la misma compra.
      const pagos: { metodo: string; restante: number; fotoUrl: string | null }[] = []
      for (const l of lineas) {
        let fotoUrl: string | null = null
        if (l.foto) {
          const comprimida = await comprimirImagen(l.foto)
          const path = `ventas/${profile.id}/${Date.now()}_${comprimida.name}`
          const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
          if (upErr) throw upErr
          fotoUrl = path
        }
        pagos.push({ metodo: l.metodo, restante: l.monto, fotoUrl })
      }

      // Cada producto es su propia fila de venta (así el stock y la anulación
      // siguen siendo por producto), pero todas van con el mismo grupo.
      const grupoId = crypto.randomUUID()
      const filasPago: {
        venta_id: string; monto: number; metodo_pago: string; foto_url: string | null; pagado_por: string
      }[] = []

      for (const l of productosVenta) {
        const p = productoDe(l.productoId)!
        const totalLinea = Math.round(Number(p.precio_venta) * l.cantidad)
        const { data: ventaCreada, error: insErr } = await supabase.from('ventas').insert({
          producto_id: p.id,
          cantidad: l.cantidad,
          precio_unitario: p.precio_venta,
          total: totalLinea,
          cliente_nombre: clienteNombre || null,
          nota: nota || null,
          venta_grupo_id: grupoId,
          vendido_por: profile.id
        }).select('id').single()
        if (insErr) throw insErr

        // Se reparte el pago entre los productos, en orden, hasta cubrir cada
        // uno. El total de los pagos ya coincide con el total de la compra.
        let falta = totalLinea
        for (const pago of pagos) {
          if (falta <= 0) break
          if (pago.restante <= 0) continue
          const usar = Math.min(falta, pago.restante)
          filasPago.push({
            venta_id: ventaCreada.id,
            monto: usar,
            metodo_pago: pago.metodo,
            foto_url: pago.fotoUrl,
            pagado_por: profile.id
          })
          pago.restante -= usar
          falta -= usar
        }
      }

      const { error: pagoErr } = await supabase.from('venta_pagos').insert(filasPago)
      if (pagoErr) throw pagoErr

      setMensaje(
        productosVenta.length === 1
          ? 'Venta registrada.'
          : `Venta de ${productosVenta.length} productos registrada.`
      )
      setCarrito([]); setProductoId(''); setCantidad('1'); setClienteNombre(''); setNota('')
      setLineasPago([]); setMonto(''); setMetodo(''); setFoto(null)
      cargarProductos()
      cargarVentasHoy()
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'No se pudo registrar la venta.') +
        ' Revisa abajo en "Ventas de hoy" si alguna línea alcanzó a quedar registrada.'
      )
      cargarProductos()
      cargarVentasHoy()
    } finally {
      setGuardando(false)
    }
  }

  // Anula la compra completa (todos sus productos vuelven al inventario).
  async function anularCompra(c: Compra) {
    const motivo = prompt('¿Por qué se anula esta venta? (los productos vuelven al inventario)')
    if (motivo === null) return
    await supabase.from('ventas').update({
      anulado: true,
      motivo_anulacion: motivo || null,
      anulado_por: profile?.id,
      anulado_at: new Date().toISOString()
    }).in('id', c.ventas.map((v) => v.id))
    cargarProductos()
    cargarVentasHoy()
  }

  // Abre la foto del pago en una pestaña nueva (URL firmada, 5 min).
  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // Las ventas viejas (de antes de poder vender varios productos juntos) no
  // tienen grupo: cada una cuenta como su propia compra.
  const compras = useMemo<Compra[]>(() => {
    const mapa = new Map<string, VentaConPagos[]>()
    for (const v of ventasHoy) {
      const clave = v.venta_grupo_id ?? v.id
      const lista = mapa.get(clave) ?? []
      lista.push(v)
      mapa.set(clave, lista)
    }
    return [...mapa.entries()].map(([clave, ventas]) => ({
      clave,
      ventas,
      total: ventas.filter((v) => !v.anulado).reduce((s, v) => s + Number(v.total), 0),
      anulada: ventas.every((v) => v.anulado)
    }))
  }, [ventasHoy])

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

        {carrito.length > 0 && (
          <ul className="space-y-1">
            {carrito.map((l) => {
              const p = productoDe(l.productoId)
              return (
                <li key={l.key} className="flex items-center justify-between text-sm bg-brand-50/50 rounded-lg px-2 py-1.5">
                  <span className="min-w-0 truncate pr-2">
                    {l.cantidad} × {p?.nombre ?? 'Producto'}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span>{pesos(Math.round(Number(p?.precio_venta ?? 0) * l.cantidad))}</span>
                    <button type="button" onClick={() => quitarProducto(l.key)} className="text-xs text-red-500">Quitar</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            {carrito.length > 0 ? 'Otro producto' : 'Producto'}
          </label>
          <select value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Selecciona…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id} disabled={stockLibre(p.id) <= 0}>
                {p.nombre} — {pesos(p.precio_venta)} ({stockLibre(p.id)} en stock)
              </option>
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
              type="number" min="1" step="1"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              max={productoSel ? stockLibre(productoSel.id) : undefined}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (opcional)</label>
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        {productoSel && (
          <button type="button" onClick={agregarProducto} className="w-full text-xs border border-brand-300 text-brand-700 rounded-lg py-1.5 font-medium">
            + Agregar este producto y sumar otro
          </button>
        )}

        {total > 0 && (
          <p className="text-sm font-semibold text-brand-700">Total: {pesos(total)}</p>
        )}

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Pago</h3>

          {lineasPago.length > 0 && (
            <ul className="space-y-1">
              {lineasPago.map((l) => (
                <li key={l.key} className="flex items-center justify-between text-sm bg-brand-50/50 rounded-lg px-2 py-1.5">
                  <span>{METODOS_PAGO.find((m) => m.valor === l.metodo)?.etiqueta}: {pesos(l.monto)}</span>
                  <button type="button" onClick={() => quitarLineaPago(l.key)} className="text-xs text-red-500">Quitar</button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Monto {lineasPago.length > 0 ? 'de este medio' : ''}</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(monto)}
                onChange={(e) => setMonto(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Medio de pago</label>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Selecciona…</option>
                {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Foto del pago {metodo && metodo !== 'efectivo' ? '(obligatoria)' : '(opcional en efectivo)'}
            </label>
            <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-xs" />
          </div>

          {(monto || metodo) && (
            <button type="button" onClick={agregarLineaPago} className="w-full text-xs border border-brand-300 text-brand-700 rounded-lg py-1.5 font-medium">
              + Agregar este medio y sumar otro (ej. el resto en Nequi)
            </button>
          )}

          {total > 0 && (
            <p className={`text-xs font-medium ${faltaPorAsignar === 0 ? 'text-green-700' : 'text-amber-600'}`}>
              {faltaPorAsignar === 0 ? '✓ Pago completo' : faltaPorAsignar > 0 ? `Falta por asignar: ${pesos(faltaPorAsignar)}` : `Sobra: ${pesos(-faltaPorAsignar)}`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" disabled={guardando || total <= 0} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {guardando ? 'Guardando…' : 'Registrar venta'}
        </button>
      </form>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500">Ventas de hoy</h2>
          <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalHoy)}</span>
        </div>
        <ul className="space-y-2">
          {compras.map((c) => {
            const primera = c.ventas[0]
            const pagos = c.ventas.flatMap((v) => v.pagos)
            // Si un pago se repartió entre varios productos, se muestra junto.
            const pagosResumidos = [...pagos.reduce((mapa, p) => {
              const clave = p.metodo_pago + '|' + (p.foto_url ?? '')
              const a = mapa.get(clave) ?? { metodo: p.metodo_pago, foto: p.foto_url, monto: 0 }
              a.monto += Number(p.monto)
              mapa.set(clave, a)
              return mapa
            }, new Map<string, { metodo: string; foto: string | null; monto: number }>()).values()]
            return (
              <li key={c.clave} className={`bg-white rounded-xl shadow-sm p-3 text-sm ${c.anulada ? 'opacity-50' : ''}`}>
                {c.ventas.map((v) => (
                  <div key={v.id} className="flex justify-between">
                    <span>
                      {v.cantidad} × {v.producto?.nombre ?? 'Producto'}
                      {v.anulado && <span className="text-red-500"> (anulada)</span>}
                    </span>
                    <span className={v.anulado ? 'line-through text-red-500' : ''}>{pesos(Number(v.total))}</span>
                  </div>
                ))}
                <div className="flex justify-between mt-1 pt-1 border-t border-gray-100">
                  <span className="text-gray-500">
                    {primera.vendedor?.nombre}
                    {primera.cliente_nombre && <span className="text-gray-400"> · {primera.cliente_nombre}</span>}
                  </span>
                  <span className="font-medium">{pesos(c.total)}</span>
                </div>
                {pagosResumidos.length > 0 && (
                  <ul className="text-xs text-green-700 space-y-0.5 mt-1">
                    {pagosResumidos.map((p, i) => (
                      <li key={i}>
                        ✓ {pesos(p.monto)} en {METODOS_PAGO.find((m) => m.valor === p.metodo)?.etiqueta}
                        {p.foto && (
                          <button onClick={() => verFoto(p.foto!)} className="ml-1 underline">ver foto</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {profile?.rol === 'superadmin' && !c.anulada && (
                  <button onClick={() => anularCompra(c)} className="text-xs text-red-500 mt-1">Anular</button>
                )}
              </li>
            )
          })}
          {compras.length === 0 && <li className="text-sm text-gray-400">Aún no hay ventas hoy.</li>}
        </ul>
      </div>
    </div>
  )
}
