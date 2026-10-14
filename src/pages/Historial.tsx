import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { rangoDiaUTC } from '../lib/fechas'
import type { RegistroTrabajo } from '../types'

const UN_MES_MS = 30 * 24 * 60 * 60 * 1000

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

function fechaLarga(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota'
  })
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota'
  })
}

export default function Historial() {
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [fecha, setFecha] = useState('')
  // Para ver los servicios de una sola profesional, sin el resto revuelto.
  const [empleadaFiltro, setEmpleadaFiltro] = useState('')
  // El registro abierto en el detalle (se toca la tarjeta para abrirlo).
  const [detalle, setDetalle] = useState<RegistroTrabajo | null>(null)

  // Borra las fotos de más de 1 mes (deja el registro sin foto).
  async function limpiarFotosViejas() {
    const corte = new Date(Date.now() - UN_MES_MS).toISOString()
    const { data } = await supabase
      .from('registros_trabajo')
      .select('id, foto_url')
      .not('foto_url', 'is', null)
      .lt('created_at', corte)
    const viejos = (data as { id: string; foto_url: string }[]) ?? []
    if (viejos.length === 0) return
    const paths = viejos.map((r) => r.foto_url).filter(Boolean)
    if (paths.length) await supabase.storage.from('evidencias').remove(paths)
    await supabase.from('registros_trabajo').update({ foto_url: null }).in('id', viejos.map((r) => r.id))
  }

  async function cargar() {
    setCargando(true)
    await limpiarFotosViejas()
    let query = supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .order('created_at', { ascending: false })
    if (fecha) {
      const { desde, hasta } = rangoDiaUTC(fecha)
      query = query.gte('created_at', desde).lt('created_at', hasta)
    } else {
      query = query.limit(300)
    }
    const { data } = await query
    setRegistros((data as RegistroTrabajo[]) ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha])

  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtroLimpio = filtro.trim().toLowerCase()
  const visibles = registros.filter((r) => {
    if (empleadaFiltro && r.empleada?.id !== empleadaFiltro) return false
    if (!filtroLimpio) return true
    return (r.cliente_nombre ?? '').toLowerCase().includes(filtroLimpio) || (r.servicio?.nombre ?? '').toLowerCase().includes(filtroLimpio)
  })

  // Las profesionales que aparecen en lo que se está viendo, para el filtro.
  const empleadas = [...new Map(
    registros.filter((r) => r.empleada).map((r) => [r.empleada!.id, r.empleada!])
  ).values()].sort((a, b) => a.nombre.localeCompare(b.nombre))

  // Totales de lo que se está viendo (sin contar lo anulado).
  const totalVisible = visibles.filter((r) => !r.anulado).reduce((s, r) => s + Number(r.precio_cobrado), 0)

  // Los demás servicios de la misma visita, para ver la atención completa.
  const mismaVisita = detalle
    ? registros.filter((r) => r.id !== detalle.id && r.visita_id && r.visita_id === detalle.visita_id)
    : []

  // Cuando el filtro coincide con el nombre de una sola clienta, se muestra
  // el total de todo lo que se le ha hecho (entre los registros cargados).
  const totalPorClienta = (() => {
    if (!filtroLimpio) return null
    const nombres = new Set(visibles.map((r) => (r.cliente_nombre || 'Sin nombre').toLowerCase()))
    if (nombres.size !== 1) return null
    const total = visibles.filter((r) => !r.anulado).reduce((s, r) => s + Number(r.precio_cobrado), 0)
    return { nombre: visibles[0].cliente_nombre || 'Sin nombre', total }
  })()

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Historial de atendidas</h1>
      <p className="text-sm text-gray-500 -mt-2">
        Las fotos se conservan <b>1 mes</b>; después queda el registro de la atención sin foto.
      </p>

      <div className="flex gap-2">
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por clienta o servicio…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {fecha && (
          <button onClick={() => setFecha('')} className="text-xs text-brand-600 font-medium shrink-0">
            Quitar fecha
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={empleadaFiltro}
          onChange={(e) => setEmpleadaFiltro(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todas las profesionales</option>
          {empleadas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        {empleadaFiltro && (
          <button onClick={() => setEmpleadaFiltro('')} className="text-xs text-brand-600 font-medium shrink-0">
            Ver todas
          </button>
        )}
      </div>

      {!cargando && visibles.length > 0 && (
        <p className="text-xs text-gray-500">
          {visibles.length} {visibles.length === 1 ? 'servicio' : 'servicios'} · total {pesos(totalVisible)}
          {empleadaFiltro && <> · solo <b>{empleadas.find((e) => e.id === empleadaFiltro)?.nombre}</b></>}
        </p>
      )}

      {totalPorClienta && (
        <p className="text-sm bg-brand-50 text-brand-700 rounded-lg px-3 py-2">
          Total de {totalPorClienta.nombre}: <b>{pesos(totalPorClienta.total)}</b>
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((r) => (
            <li
              key={r.id}
              onClick={() => setDetalle(r)}
              className={`bg-white rounded-xl shadow-sm p-3 text-sm flex items-center justify-between gap-2 cursor-pointer active:bg-gray-50 ${r.anulado ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{r.cliente_nombre || 'Sin nombre'}</p>
                <p className="text-xs text-gray-400 truncate">
                  {r.servicio?.nombre}{r.nota && ` · ${r.nota}`} · {r.empleada?.nombre} · {fechaCorta(r.created_at)}
                  {r.anulado && <span className="text-red-500"> (anulado)</span>}
                  {r.es_garantia && <span className="text-amber-600"> (garantía)</span>}
                  {r.comision_anulada && <span className="text-red-500"> (sin comisión: se rehízo por garantía)</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-medium">${Number(r.precio_cobrado).toLocaleString('es-CO')}</span>
                {r.foto_url ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); verFoto(r.foto_url!) }}
                    className="text-xs bg-brand-100 text-brand-700 rounded-lg px-2 py-1"
                  >
                    Ver foto
                  </button>
                ) : (
                  <span className="text-xs text-gray-300">sin foto</span>
                )}
                <span className="text-gray-300">›</span>
              </div>
            </li>
          ))}
          {visibles.length === 0 && <li className="text-sm text-gray-400">Sin atenciones registradas.</li>}
        </ul>
      )}

      {/* Detalle completo de una atención: lo que no cabe en la lista. */}
      {detalle && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
          onClick={() => setDetalle(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold truncate">{detalle.cliente_nombre || 'Sin nombre'}</h2>
                <p className="text-xs text-gray-400">{fechaLarga(detalle.created_at)}</p>
              </div>
              <button onClick={() => setDetalle(null)} className="text-sm text-gray-400 shrink-0">Cerrar ✕</button>
            </div>

            {detalle.anulado && (
              <p className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">
                Anulado{detalle.motivo_anulacion ? `: ${detalle.motivo_anulacion}` : ''}
              </p>
            )}
            {detalle.es_garantia && (
              <p className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg p-2">
                🛠 Garantía — no se le cobró a la clienta, pero sí comisiona.
              </p>
            )}
            {detalle.comision_anulada && (
              <p className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg p-2">
                Sin comisión: este trabajo se tuvo que rehacer por garantía
                {detalle.comision_anulada_motivo ? ` (${detalle.comision_anulada_motivo})` : ''}.
              </p>
            )}

            <dl className="text-sm divide-y divide-gray-100">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-gray-500 shrink-0">Servicio</dt>
                <dd className="text-right">{detalle.servicio?.nombre ?? 'Servicio'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-gray-500 shrink-0">Atendió</dt>
                <dd className="text-right">{detalle.empleada?.nombre ?? 'Sin asignar'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-gray-500 shrink-0">Registrado</dt>
                <dd className="text-right">{fechaCorta(detalle.created_at)} · {horaLocal(detalle.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-gray-500 shrink-0">Valor</dt>
                <dd className="text-right font-semibold">{pesos(Number(detalle.precio_cobrado))}</dd>
              </div>
              {Number(detalle.descuento_porcentaje) > 0 && (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-gray-500 shrink-0">Descuento</dt>
                  <dd className="text-right">{detalle.descuento_porcentaje}%</dd>
                </div>
              )}
              {detalle.cliente_telefono && (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-gray-500 shrink-0">Teléfono</dt>
                  <dd className="text-right">{detalle.cliente_telefono}</dd>
                </div>
              )}
              {detalle.nota && (
                <div className="flex justify-between gap-3 py-1.5">
                  <dt className="text-gray-500 shrink-0">Nota</dt>
                  <dd className="text-right">{detalle.nota}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-gray-500 shrink-0">Vino de</dt>
                <dd className="text-right">{detalle.cita_id ? 'Una cita agendada' : 'Sin cita (llegó directo)'}</dd>
              </div>
            </dl>

            {mismaVisita.length > 0 && (
              <div className="border-t border-gray-100 pt-2">
                <h3 className="text-xs font-semibold text-gray-500 mb-1">Otros servicios de la misma visita</h3>
                <ul className="text-sm space-y-1">
                  {mismaVisita.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span className="truncate">{o.servicio?.nombre} · {o.empleada?.nombre}</span>
                      <span className="shrink-0">{pesos(Number(o.precio_cobrado))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detalle.foto_url ? (
              <button
                onClick={() => verFoto(detalle.foto_url!)}
                className="w-full bg-brand-100 text-brand-700 text-sm font-medium rounded-lg py-2"
              >
                Ver foto del trabajo
              </button>
            ) : (
              <p className="text-xs text-gray-400 text-center">Sin foto (se conservan 1 mes).</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
