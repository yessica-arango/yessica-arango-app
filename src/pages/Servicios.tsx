import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CATEGORIAS_SERVICIOS } from '../lib/categoriasServicios'
import type { Servicio } from '../types'

export default function Servicios() {
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_SERVICIOS[0])
  const [precioNuevo, setPrecioNuevo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase
      .from('servicios')
      .select('*')
      .order('categoria')
      .order('nombre')
    const lista = (data as Servicio[]) ?? []
    setServicios(lista)
    setPrecios(Object.fromEntries(lista.map((s) => [s.id, String(s.precio_base)])))
  }

  useEffect(() => {
    cargar()
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

  async function guardarPrecio(id: string) {
    const valor = Number(precios[id])
    if (Number.isNaN(valor) || valor < 0) return
    setGuardandoId(id)
    await supabase.from('servicios').update({ precio_base: valor }).eq('id', id)
    setGuardandoId(null)
    cargar()
  }

  async function alternarActivo(s: Servicio) {
    await supabase.from('servicios').update({ activo: !s.activo }).eq('id', s.id)
    cargar()
  }

  async function crearServicio(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    const { error } = await supabase.from('servicios').insert({
      categoria,
      nombre,
      precio_base: Number(precioNuevo || 0)
    })
    if (error) {
      setError('No se pudo crear el servicio. Revisa que no exista ya uno con el mismo nombre en esa categoría.')
    } else {
      setMensaje('Servicio agregado.')
      setNombre('')
      setPrecioNuevo('')
      cargar()
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Servicios y precios</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Aquí puedes actualizar los precios cuando quieras, sin depender de nadie más. Los cambios
        aplican solo a los trabajos que se registren de ahora en adelante.
      </p>

      <form onSubmit={crearServicio} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agregar nuevo servicio</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Categoría</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              {CATEGORIAS_SERVICIOS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Precio</label>
            <input
              type="number" min="0" step="0.01"
              value={precioNuevo}
              onChange={(e) => setPrecioNuevo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del servicio</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          Agregar servicio
        </button>
      </form>

      {porCategoria.map(([cat, lista]) => (
        <div key={cat} className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold text-sm text-brand-700 mb-3">{cat}</h2>
          <ul className="divide-y divide-gray-100">
            {lista.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3">
                <span className={`flex-1 text-sm ${s.activo ? '' : 'text-gray-400 line-through'}`}>{s.nombre}</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={precios[s.id] ?? ''}
                    onChange={(e) => setPrecios((p) => ({ ...p, [s.id]: e.target.value }))}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <button
                  onClick={() => guardarPrecio(s.id)}
                  disabled={guardandoId === s.id || precios[s.id] === String(s.precio_base)}
                  className="text-xs px-2 py-1 rounded-lg bg-brand-100 text-brand-700 disabled:opacity-40"
                >
                  Guardar
                </button>
                <button
                  onClick={() => alternarActivo(s)}
                  className={`text-xs px-2 py-1 rounded-full ${s.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                >
                  {s.activo ? 'Activo' : 'Inactivo'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
