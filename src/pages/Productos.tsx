import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Producto } from '../types'

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [editando, setEditando] = useState<Record<string, { precio_venta: string; costo: string; stock: string }>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [costo, setCosto] = useState('')
  const [stock, setStock] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase.from('productos').select('*').order('nombre')
    const lista = (data as Producto[]) ?? []
    setProductos(lista)
    setEditando(
      Object.fromEntries(
        lista.map((p) => [p.id, {
          precio_venta: String(p.precio_venta),
          costo: p.costo != null ? String(p.costo) : '',
          stock: String(p.stock)
        }])
      )
    )
  }

  useEffect(() => {
    cargar()
  }, [])

  async function crearProducto(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('productos').insert({
      nombre,
      descripcion: descripcion || null,
      precio_venta: Number(precioVenta || 0),
      costo: costo ? Number(costo) : null,
      stock: Number(stock || 0),
      creado_por: user.id
    })
    if (error) {
      setError('No se pudo crear el producto: ' + error.message)
    } else {
      setMensaje('Producto agregado.')
      setNombre(''); setDescripcion(''); setPrecioVenta(''); setCosto(''); setStock('0')
      cargar()
    }
  }

  async function guardarCambios(id: string) {
    const e = editando[id]
    if (!e) return
    setGuardandoId(id)
    await supabase.from('productos').update({
      precio_venta: Number(e.precio_venta || 0),
      costo: e.costo ? Number(e.costo) : null,
      stock: Math.max(0, Math.round(Number(e.stock || 0)))
    }).eq('id', id)
    setGuardandoId(null)
    cargar()
  }

  async function alternarActivo(p: Producto) {
    await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id)
    cargar()
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Inventario</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Agrega los productos de a poco. Aquí controlas precio, costo y stock; las ventas y los
        insumos fiados descuentan el stock automáticamente.
      </p>

      <form onSubmit={crearProducto} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agregar producto</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Nombre</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Descripción (opcional)</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Precio de venta</label>
            <input type="number" min="0" step="0.01" required value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Costo (opcional)</label>
            <input type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Stock inicial</label>
            <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          Agregar producto
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow p-4">
        <ul className="divide-y divide-gray-100">
          {productos.map((p) => {
            const e = editando[p.id] ?? { precio_venta: '', costo: '', stock: '' }
            const cambiado =
              e.precio_venta !== String(p.precio_venta) ||
              e.costo !== (p.costo != null ? String(p.costo) : '') ||
              e.stock !== String(p.stock)
            return (
              <li key={p.id} className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`flex-1 text-sm font-medium ${p.activo ? '' : 'text-gray-400 line-through'}`}>{p.nombre}</span>
                  <button
                    onClick={() => alternarActivo(p)}
                    className={`text-xs px-2 py-1 rounded-full ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                  >
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </button>
                </div>
                {p.descripcion && <p className="text-xs text-gray-400">{p.descripcion}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-500">Precio
                    <input
                      type="number" min="0" step="0.01"
                      value={e.precio_venta}
                      onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, precio_venta: ev.target.value } }))}
                      className="ml-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-500">Costo
                    <input
                      type="number" min="0" step="0.01"
                      value={e.costo}
                      onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, costo: ev.target.value } }))}
                      className="ml-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-500">Stock
                    <input
                      type="number" min="0" step="1"
                      value={e.stock}
                      onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, stock: ev.target.value } }))}
                      className="ml-1 w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <button
                    onClick={() => guardarCambios(p.id)}
                    disabled={!cambiado || guardandoId === p.id}
                    className="text-xs px-2 py-1 rounded-lg bg-brand-100 text-brand-700 disabled:opacity-40"
                  >
                    Guardar
                  </button>
                  {p.stock <= 3 && p.activo && (
                    <span className="text-xs text-amber-600 font-medium">⚠ Stock bajo</span>
                  )}
                </div>
              </li>
            )
          })}
          {productos.length === 0 && <li className="py-3 text-sm text-gray-400">Aún no hay productos. Agrega el primero arriba.</li>}
        </ul>
      </div>
    </div>
  )
}
