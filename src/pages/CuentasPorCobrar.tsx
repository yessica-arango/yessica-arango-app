import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Cita, type Cobro, type RegistroTrabajo } from '../types'

// Una "visita" agrupa los servicios registrados juntos para una misma clienta.
interface Visita {
  visitaId: string
  clienteNombre: string
  empleadaNombre: string
  hora: string
  registros: RegistroTrabajo[]
  total: number
  abono: number
  cobrado: number
  pendiente: number
  cobros: Cobro[]
}

export default function CuentasPorCobrar() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(fechaHoy())
  const [visitas, setVisitas] = useState<Visita[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Formulario de cobro abierto (por visita)
  const [cobrandoId, setCobrandoId] = useState<string | null>(null)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [notaCobro, setNotaCobro] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { desde, hasta } = rangoDiaUTC(fecha)
    const { data: regs } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .eq('anulado', false)
      .order('created_at')
    const registros = (regs as RegistroTrabajo[]) ?? []

    // Agrupar por visita (los registros viejos sin visita_id cuentan como visita propia)
    const grupos = new Map<string, RegistroTrabajo[]>()
    for (const r of registros) {
      const clave = r.visita_id ?? r.id
      const lista = grupos.get(clave) ?? []
      lista.push(r)
      grupos.set(clave, lista)
    }

    const visitaIds = [...grupos.keys()]
    const citaIds = [...new Set(registros.map((r) => r.cita_id).filter(Boolean))] as string[]

    const [{ data: cobrosData }, { data: citasData }] = await Promise.all([
      visitaIds.length > 0
        ? supabase.from('cobros').select('*').in('visita_id', visitaIds)
        : Promise.resolve({ data: [] as Cobro[] }),
      citaIds.length > 0
        ? supabase.from('citas').select('*').in('id', citaIds)
        : Promise.resolve({ data: [] as Cita[] })
    ])
    const cobros = (cobrosData as Cobro[]) ?? []
    const citas = (citasData as Cita[]) ?? []

    const lista: Visita[] = [...grupos.entries()].map(([visitaId, regsVisita]) => {
      const total = regsVisita.reduce((s, r) => s + Number(r.precio_cobrado), 0)
      const cita = citas.find((c) => c.id === regsVisita[0].cita_id)
      const abono = cita ? Number(cita.abono) : 0
      const cobrosVisita = cobros.filter((c) => c.visita_id === visitaId)
      const cobrado = cobrosVisita.reduce((s, c) => s + Number(c.monto), 0)
      return {
        visitaId,
        clienteNombre: regsVisita[0].cliente_nombre || 'Sin nombre',
        empleadaNombre: regsVisita[0].empleada?.nombre ?? '',
        hora: new Date(regsVisita[0].created_at).toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota'
        }),
        registros: regsVisita,
        total,
        abono,
        cobrado,
        pendiente: Math.max(0, total - abono - cobrado),
        cobros: cobrosVisita
      }
    })
    setVisitas(lista)
    setCargando(false)
  }, [fecha])

  useEffect(() => {
    cargar()
  }, [cargar])

  function abrirCobro(v: Visita) {
    setCobrandoId(v.visitaId)
    setMonto(String(v.pendiente))
    setMetodo('')
    setFoto(null)
    setNotaCobro('')
    setError(null)
    setMensaje(null)
  }

  async function registrarCobro(e: FormEvent, v: Visita) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    const valor = Number(monto)
    if (!valor || valor <= 0) { setError('Escribe el monto cobrado.'); return }
    if (!metodo) { setError('Elige el medio de pago.'); return }
    // Para pagos digitales la foto del comprobante es obligatoria.
    if (metodo !== 'efectivo' && !foto) {
      setError('Sube la foto del comprobante del pago.')
      return
    }

    setGuardando(true)
    try {
      let fotoUrl: string | null = null
      if (foto) {
        const comprimida = await comprimirImagen(foto)
        const path = `cobros/${profile.id}/${Date.now()}_${comprimida.name}`
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
        if (upErr) throw upErr
        fotoUrl = path
      }

      const { error: insErr } = await supabase.from('cobros').insert({
        visita_id: v.visitaId,
        monto: valor,
        metodo_pago: metodo,
        foto_url: fotoUrl,
        nota: notaCobro || null,
        cobrado_por: profile.id
      })
      if (insErr) throw insErr

      setMensaje(`Cobro de $${valor.toLocaleString('es-CO')} registrado a ${v.clienteNombre}.`)
      setCobrandoId(null)
      cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el cobro.')
    } finally {
      setGuardando(false)
    }
  }

  // Abre la foto del pago en una pestaña nueva (URL firmada, 5 min).
  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const pendientes = visitas.filter((v) => v.pendiente > 0)
  const cobradas = visitas.filter((v) => v.pendiente === 0)
  const totalPendiente = pendientes.reduce((s, v) => s + v.pendiente, 0)

  function tarjetaVisita(v: Visita, esPendiente: boolean) {
    return (
      <li key={v.visitaId} className="bg-white rounded-2xl shadow p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{v.clienteNombre}</p>
            <p className="text-xs text-gray-400">{v.hora} · atendió {v.empleadaNombre}</p>
          </div>
          {esPendiente ? (
            <span className="shrink-0 text-sm font-semibold text-amber-600">
              Debe ${v.pendiente.toLocaleString('es-CO')}
            </span>
          ) : (
            <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Cobrada</span>
          )}
        </div>

        {/* Cuenta detallada, como un recibo: servicios, subtotal, abono/cobros y total */}
        <div className="text-sm border-y border-dashed border-gray-200 py-2 space-y-1">
          {v.registros.map((r) => (
            <div key={r.id} className="flex justify-between text-gray-600">
              <span className="truncate pr-2">{r.servicio?.nombre ?? 'Servicio'}{r.nota ? ` · ${r.nota}` : ''}</span>
              <span className="shrink-0">${Number(r.precio_cobrado).toLocaleString('es-CO')}</span>
            </div>
          ))}
          <div className="flex justify-between text-gray-500 pt-1 border-t border-gray-100">
            <span>Subtotal</span>
            <span>${v.total.toLocaleString('es-CO')}</span>
          </div>
          {v.abono > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Abono</span>
              <span>-${v.abono.toLocaleString('es-CO')}</span>
            </div>
          )}
          {v.cobrado > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Cobrado</span>
              <span>-${v.cobrado.toLocaleString('es-CO')}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-1 border-t border-gray-200">
            <span className="font-semibold text-gray-700">TOTAL</span>
            <span className={`font-bold text-base ${v.pendiente > 0 ? 'text-amber-600' : 'text-green-700'}`}>
              ${v.pendiente.toLocaleString('es-CO')}
            </span>
          </div>
        </div>

        {v.cobros.length > 0 && (
          <ul className="text-xs text-green-700 space-y-0.5">
            {v.cobros.map((c) => (
              <li key={c.id}>
                ✓ ${Number(c.monto).toLocaleString('es-CO')} en {METODOS_PAGO.find((m) => m.valor === c.metodo_pago)?.etiqueta}
                {c.foto_url && (
                  <button onClick={() => verFoto(c.foto_url!)} className="ml-1 underline">ver foto</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {esPendiente && cobrandoId !== v.visitaId && (
          <button
            onClick={() => abrirCobro(v)}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg py-2 transition"
          >
            Cobrar
          </button>
        )}

        {cobrandoId === v.visitaId && (
          <form onSubmit={(e) => registrarCobro(e, v)} className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Monto cobrado</label>
                <input
                  type="text" inputMode="numeric" required
                  value={formatearPesosInput(monto)}
                  onChange={(e) => setMonto(soloDigitos(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Medio de pago</label>
                <select required value={metodo} onChange={(e) => setMetodo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Selecciona…</option>
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                Foto del pago {metodo && metodo !== 'efectivo' ? '(obligatoria)' : '(opcional en efectivo)'}
              </label>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-xs" />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Nota (opcional)</label>
              <input value={notaCobro} onChange={(e) => setNotaCobro(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            </div>

            <p className="text-[11px] text-gray-400">
              Si la clienta paga con dos medios (ej: mitad efectivo, mitad Nequi), registra un cobro por cada uno.
            </p>

            <div className="flex gap-2">
              <button type="submit" disabled={guardando} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2">
                {guardando ? 'Guardando…' : 'Registrar cobro'}
              </button>
              <button type="button" onClick={() => setCobrandoId(null)} className="px-3 text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </li>
    )
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Cuentas por cobrar</h1>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
      {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          {pendientes.length} visita(s) por cobrar · Total pendiente: <b>${totalPendiente.toLocaleString('es-CO')}</b>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Por cobrar</h2>
        <ul className="space-y-3">
          {pendientes.map((v) => tarjetaVisita(v, true))}
          {!cargando && pendientes.length === 0 && (
            <li className="text-sm text-gray-400">No hay cuentas pendientes este día. 🎉</li>
          )}
        </ul>
      </div>

      {cobradas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Ya cobradas</h2>
          <ul className="space-y-3">
            {cobradas.map((v) => tarjetaVisita(v, false))}
          </ul>
        </div>
      )}
    </div>
  )
}
