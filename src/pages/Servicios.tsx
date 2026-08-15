import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CATEGORIAS_SERVICIOS } from '../lib/categoriasServicios'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { useAuth } from '../contexts/AuthContext'
import type { Obsequio, Servicio } from '../types'

export default function Servicios() {
  const { profile } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_SERVICIOS[0])
  // La última opción del selector abre este campo para escribir una
  // categoría que no está en la lista. No hace falta guardarla en ninguna
  // tabla: servicios.categoria es texto libre, así que la categoría "existe"
  // desde que se crea el primer servicio con ese nombre, y desde ahí aparece
  // sola en el selector (ver categoriasDisponibles).
  const [categoriaNueva, setCategoriaNueva] = useState('')
  const [precioNuevo, setPrecioNuevo] = useState('')
  // Un combo no tiene precio propio: se arma sumando el valor (y la
  // duración, para que el calendario le reserve el tiempo correcto) de los
  // servicios que lo componen.
  const [combosIds, setCombosIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Valor centinela del <option> que abre el campo de texto. Lleva caracteres
  // que no se pueden teclear en el input para que jamás choque con el nombre
  // real de una categoría.
  const NUEVA_CATEGORIA = '__nueva__'

  // Las fijas del código más las que ya se hayan creado a mano (salen de los
  // servicios existentes), sin repetir y en el orden de siempre primero.
  const categoriasDisponibles = useMemo(() => {
    const usadas = servicios.map((s) => s.categoria)
    return [...new Set<string>([...CATEGORIAS_SERVICIOS, ...usadas])]
  }, [servicios])

  const creandoCategoria = categoria === NUEVA_CATEGORIA
  // Lo que de verdad se va a guardar: el texto escrito si está creando una
  // categoría nueva, o la seleccionada.
  const categoriaFinal = creandoCategoria ? categoriaNueva.trim() : categoria
  const esCombo = categoriaFinal === 'Combo'
  const serviciosParaCombo = servicios.filter((s) => s.activo && s.categoria !== 'Combo' && s.categoria !== 'Adicional')
  const preciosCombo = servicios.filter((s) => combosIds.includes(s.id))
  const precioComboTotal = preciosCombo.reduce((sum, s) => sum + Number(s.precio_base), 0)
  const duracionComboTotal = preciosCombo.reduce((sum, s) => sum + Number(s.duracion_minutos), 0)

  function cambiarCategoria(c: string) {
    setCategoria(c)
    if (c !== NUEVA_CATEGORIA) setCategoriaNueva('')
    setCombosIds([])
  }

  function alternarComboServicio(id: string) {
    setCombosIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const [obsequios, setObsequios] = useState<Obsequio[]>([])
  const [nombreObsequio, setNombreObsequio] = useState('')
  const [errorObsequio, setErrorObsequio] = useState<string | null>(null)

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

  async function cargarObsequios() {
    const { data } = await supabase.from('obsequios').select('*').order('nombre')
    setObsequios((data as Obsequio[]) ?? [])
  }

  useEffect(() => {
    cargar()
    cargarObsequios()
  }, [])

  async function crearObsequio(e: FormEvent) {
    e.preventDefault()
    setErrorObsequio(null)
    if (!profile) return
    const { error } = await supabase.from('obsequios').insert({ nombre: nombreObsequio.trim(), creado_por: profile.id })
    if (error) {
      setErrorObsequio(
        error.message.toLowerCase().includes('duplicate') ? 'Ya existe un obsequio con ese nombre.' : 'No se pudo agregar: ' + error.message
      )
    } else {
      setNombreObsequio('')
      cargarObsequios()
    }
  }

  async function alternarObsequio(o: Obsequio) {
    await supabase.from('obsequios').update({ activo: !o.activo }).eq('id', o.id)
    cargarObsequios()
  }

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
    if (creandoCategoria && !categoriaFinal) {
      setError('Escribe el nombre de la categoría nueva.')
      return
    }
    if (esCombo && combosIds.length < 2) {
      setError('Elige al menos 2 servicios para armar el combo.')
      return
    }
    const { error } = await supabase.from('servicios').insert({
      categoria: categoriaFinal,
      nombre,
      precio_base: esCombo ? precioComboTotal : Number(precioNuevo || 0),
      duracion_minutos: esCombo ? duracionComboTotal : undefined
    })
    if (error) {
      setError('No se pudo crear el servicio. Revisa que no exista ya uno con el mismo nombre en esa categoría.')
    } else {
      setMensaje('Servicio agregado.')
      setNombre('')
      setPrecioNuevo('')
      setCombosIds([])
      // Si acabó de estrenar una categoría, dejarla seleccionada: ya existe
      // (el servicio recién creado la trae) y así puede seguir agregándole
      // servicios sin volver a escribirla.
      if (creandoCategoria) {
        setCategoria(categoriaFinal)
        setCategoriaNueva('')
      }
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Categoría</label>
            <select value={categoria} onChange={(e) => cambiarCategoria(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              {categoriasDisponibles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={NUEVA_CATEGORIA}>➕ Nueva categoría…</option>
            </select>
            {creandoCategoria && (
              <input
                autoFocus
                value={categoriaNueva}
                onChange={(e) => setCategoriaNueva(e.target.value)}
                placeholder="Nombre de la categoría (ej. Uñas de pies)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 mt-2"
              />
            )}
          </div>
          {!esCombo && (
            <div>
              <label className="block text-sm font-medium mb-1">Precio</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(precioNuevo)}
                onChange={(e) => setPrecioNuevo(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del servicio</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        {esCombo && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-sm font-medium">¿Qué servicios incluye el combo?</p>
            <p className="text-xs text-gray-400 -mt-1">El precio y la duración del combo se suman solos según lo que marques.</p>
            <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
              {serviciosParaCombo.map((s) => {
                const activo = combosIds.includes(s.id)
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => alternarComboServicio(s.id)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border ${activo ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-500'}`}
                  >
                    {activo ? '✓ ' : ''}{s.nombre} · ${Number(s.precio_base).toLocaleString('es-CO')}
                  </button>
                )
              })}
              {serviciosParaCombo.length === 0 && <p className="text-xs text-gray-400">No hay servicios activos para armar un combo.</p>}
            </div>
            {combosIds.length > 0 && (
              <p className="text-sm font-semibold text-brand-700">
                Precio del combo: ${precioComboTotal.toLocaleString('es-CO')} · {duracionComboTotal} min
              </p>
            )}
          </div>
        )}

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
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(precios[s.id] ?? '')}
                    onChange={(e) => setPrecios((p) => ({ ...p, [s.id]: soloDigitos(e.target.value) }))}
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

      <div className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="font-semibold text-sm text-gray-600">Obsequios</h2>
        <p className="text-xs text-gray-400 -mt-2">
          Las cortesías que se pueden ofrecer al agendar o confirmar una cita. Agrega las que quieras
          aparte de las que ya vienen predeterminadas.
        </p>
        {errorObsequio && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{errorObsequio}</div>}
        <form onSubmit={crearObsequio} className="flex gap-2">
          <input
            required
            value={nombreObsequio}
            onChange={(e) => setNombreObsequio(e.target.value)}
            placeholder="Ej: Baño de burbujas"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="px-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
            Agregar
          </button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {obsequios.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => alternarObsequio(o)}
                className={`text-xs px-2 py-1 rounded-full ${o.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-400 line-through'}`}
              >
                {o.nombre}
              </button>
            </li>
          ))}
          {obsequios.length === 0 && <li className="text-sm text-gray-400">Aún no hay obsequios.</li>}
        </ul>
      </div>
    </div>
  )
}
