import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import { rangoDiaEfectivo } from '../lib/cierreDia'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import {
  METODOS_PAGO,
  type Cita,
  type CierreCaja as CierreCajaTipo,
  type Cobro,
  type CreditoCliente,
  type MetodoPago,
  type Prestamo,
  type PrestamoPago,
  type RegistroTrabajo,
  type TipoCierreCaja
} from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' })
}

interface CierreConAdmin extends CierreCajaTipo {
  administradora?: { nombre: string }
}

// El cierre reporta cada medio en su propia columna (no en una tabla de
// líneas), así que hace falta este mapeo para leer/sumar por medio.
function campoReportado(c: CierreCajaTipo, metodo: MetodoPago): number {
  switch (metodo) {
    case 'efectivo': return Number(c.efectivo_entregado)
    case 'nequi': return Number(c.nequi_reportado)
    case 'daviplata': return Number(c.daviplata_reportado)
    case 'datafono': return Number(c.datafono_reportado)
    case 'bre_b': return Number(c.bre_b_reportado)
  }
}

function sumaPorMetodo<T>(items: T[], metodo: (t: T) => MetodoPago | null, monto: (t: T) => number): Record<MetodoPago, number> {
  const mapa: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
  for (const item of items) {
    const m = metodo(item)
    if (m) mapa[m] += monto(item)
  }
  return mapa
}

export default function CierreCaja() {
  const { profile } = useAuth()
  const esSuperadmin = profile?.rol === 'superadmin'
  const [fecha, setFecha] = useState(inicioDeHoy())

  // Dos cuadres totalmente independientes por día: "servicios" (lo de
  // siempre: cobros, préstamos, reembolsos, pago a proveedores) y "abonos"
  // (solo los abonos de citas) -- cada uno con su propio formulario y su
  // propio esperado/reportado, para no mezclar dinero de servicios de hoy
  // con dinero pre-pagado para citas futuras.
  const [tab, setTab] = useState<TipoCierreCaja>('servicios')
  function cambiarTab(t: TipoCierreCaja) {
    setTab(t)
    setMensaje(null)
    setError(null)
  }

  // Formulario del cuadre de servicios
  const [base, setBase] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [nequi, setNequi] = useState('')
  const [daviplata, setDaviplata] = useState('')
  const [datafono, setDatafono] = useState('')
  const [breB, setBreB] = useState('')
  const [proveedorMonto, setProveedorMonto] = useState('')
  const [proveedorMetodo, setProveedorMetodo] = useState('')
  const [proveedoresGuardados, setProveedoresGuardados] = useState<string[]>([])
  const [proveedorNota, setProveedorNota] = useState('')
  const [observaciones, setObservaciones] = useState('')

  // Formulario del cuadre de abonos -- mismos 5 medios, sin base ni
  // proveedores (no aplican a abonos).
  const [aboEfectivo, setAboEfectivo] = useState('')
  const [aboNequi, setAboNequi] = useState('')
  const [aboDaviplata, setAboDaviplata] = useState('')
  const [aboDatafono, setAboDatafono] = useState('')
  const [aboBreB, setAboBreB] = useState('')
  const [aboObservaciones, setAboObservaciones] = useState('')

  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Resumen del día seleccionado
  const [trabajos, setTrabajos] = useState<RegistroTrabajo[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [citasConAbono, setCitasConAbono] = useState<Cita[]>([])
  const [prestamosHoy, setPrestamosHoy] = useState<Prestamo[]>([])
  const [pagosPrestamoHoy, setPagosPrestamoHoy] = useState<PrestamoPago[]>([])
  const [reembolsosHoy, setReembolsosHoy] = useState<CreditoCliente[]>([])
  const [cierresServiciosDelDia, setCierresServiciosDelDia] = useState<CierreConAdmin[]>([])
  const [cierresAbonosDelDia, setCierresAbonosDelDia] = useState<CierreConAdmin[]>([])
  // Si el rango de dinero se recortó porque ya se cerró la caja de ayer o de
  // hoy, se guarda la hora del corte para avisarlo (ver "cargarDia" abajo).
  // Cada cuadre tiene su propio corte -- cerrar "servicios" no corta "abonos".
  const [corteAyerHoraServicios, setCorteAyerHoraServicios] = useState<string | null>(null)
  const [corteHoyHoraServicios, setCorteHoyHoraServicios] = useState<string | null>(null)
  const [corteAyerHoraAbonos, setCorteAyerHoraAbonos] = useState<string | null>(null)
  const [corteHoyHoraAbonos, setCorteHoyHoraAbonos] = useState<string | null>(null)

  // Prestado pendiente TOTAL (como la Base: siempre visible, sin importar la fecha o la pestaña)
  const [prestamosPendientes, setPrestamosPendientes] = useState<Prestamo[]>([])
  const [pagosPrestamoTodos, setPagosPrestamoTodos] = useState<PrestamoPago[]>([])

  // De lo trabajado hoy específicamente, separado en las mismas dos bolsas
  // que el resto de la pantalla: lo que de verdad es dinero de "servicios y
  // productos" (cobros, sin importar qué día se registraron) y lo que es
  // abono de cita (sin importar de qué módulo salió -- cliente, admin o
  // dueña -- ni qué día se pagó). Un abono NUNCA cuenta como "cobrado en
  // servicios" en esta pestaña, aunque haya cubierto por completo un
  // trabajo de hoy -- ese dinero se cuadra en la pestaña «Abonos».
  const [cobradoServiciosTrabajoHoy, setCobradoServiciosTrabajoHoy] = useState(0)
  // El abono se paga al CREAR la cita, que muchas veces es un día distinto al
  // día en que se hace el trabajo. Ese dinero se cuadra en la pestaña
  // «Abonos» DEL DÍA EN QUE SE PAGÓ, no del día del trabajo -- por eso hay
  // que separarlos, o se busca un abono en la pestaña de hoy que en realidad
  // está en la de otro día.
  const [cubiertoPorAbonoHoy, setCubiertoPorAbonoHoy] = useState(0)
  const [cubiertoPorAbonoOtroDia, setCubiertoPorAbonoOtroDia] = useState(0)
  const [pendienteTrabajoHoy, setPendienteTrabajoHoy] = useState(0)
  const [condonadoTrabajoHoy, setCondonadoTrabajoHoy] = useState(0)
  // El detalle (quién, cuánto, de qué día) de lo cobrado/abonado en otro
  // día — para poder verificar si de verdad corresponde a eso o si algo
  // quedó mal registrado.
  const [detalleCobradoOtroDia, setDetalleCobradoOtroDia] = useState<{ clienteNombre: string; monto: number; detalle: string }[]>([])

  useEffect(() => {
    let cancelado = false
    async function cargarDia() {
      const { desde, hasta } = rangoDiaUTC(fecha)
      // Los movimientos de dinero (cobros, abonos, préstamos, reembolsos) usan
      // el rango "efectivo" de CADA cuadre: si ya se cerró servicios de este
      // día, lo que se cobre después cuenta para el cierre de servicios de
      // mañana; lo mismo para abonos, por separado. Lo trabajado
      // (registros_trabajo) no es un movimiento de caja, así que sigue por
      // el día de calendario puro.
      const [rangoServicios, rangoAbonos] = await Promise.all([
        rangoDiaEfectivo(fecha, 'servicios'),
        rangoDiaEfectivo(fecha, 'abonos')
      ])
      if (cancelado) return
      // desde < inicio del día => se está arrastrando la cola de ayer (lo que
      // entró después del cierre de ayer). Nunca al revés: cerrar ayer no le
      // puede recortar horas a hoy.
      setCorteAyerHoraServicios(rangoServicios.desde < desde ? rangoServicios.desde : null)
      setCorteHoyHoraServicios(rangoServicios.hasta < hasta ? rangoServicios.hasta : null)
      setCorteAyerHoraAbonos(rangoAbonos.desde < desde ? rangoAbonos.desde : null)
      setCorteHoyHoraAbonos(rangoAbonos.hasta < hasta ? rangoAbonos.hasta : null)
      supabase
        .from('registros_trabajo')
        .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
        .gte('created_at', desde)
        .lt('created_at', hasta)
        .eq('anulado', false)
        .order('created_at')
        .then(({ data }) => setTrabajos((data as RegistroTrabajo[]) ?? []))
      supabase
        .from('cobros')
        .select('*')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .then(({ data }) => setCobros((data as Cobro[]) ?? []))
      supabase
        .from('citas')
        .select('*')
        .gte('created_at', rangoAbonos.desde)
        .lt('created_at', rangoAbonos.hasta)
        .gt('abono', 0)
        .neq('estado', 'cancelada')
        .order('created_at', { ascending: false })
        .then(({ data }) => setCitasConAbono((data as Cita[]) ?? []))
      supabase
        .from('prestamos')
        .select('*, persona:profiles!prestamos_persona_id_fkey(nombre)')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .then(({ data }) => setPrestamosHoy((data as Prestamo[]) ?? []))
      supabase
        .from('prestamo_pagos')
        .select('*')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .then(({ data }) => setPagosPrestamoHoy((data as PrestamoPago[]) ?? []))
      supabase
        .from('creditos_clientes')
        .select('*')
        .eq('resolucion', 'reembolso')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .then(({ data }) => setReembolsosHoy((data as CreditoCliente[]) ?? []))
      supabase
        .from('cierres_caja')
        .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
        .eq('fecha', fecha)
        .then(({ data }) => {
          const todos = (data as CierreConAdmin[]) ?? []
          setCierresServiciosDelDia(todos.filter((c) => c.tipo === 'servicios'))
          setCierresAbonosDelDia(todos.filter((c) => c.tipo === 'abonos'))
        })
    }
    cargarDia()
    return () => { cancelado = true }
  }, [fecha])

  useEffect(() => {
    supabase.from('prestamos').select('*').eq('pagado', false)
      .then(({ data }) => setPrestamosPendientes((data as Prestamo[]) ?? []))
    supabase.from('prestamo_pagos').select('prestamo_id, monto')
      .then(({ data }) => setPagosPrestamoTodos((data as PrestamoPago[]) ?? []))
    // Sugerencias de proveedor ya guardados en Inventario, para no tener que
    // escribirlos de nuevo cada vez que se les paga.
    supabase.from('productos').select('proveedor').not('proveedor', 'is', null)
      .then(({ data }) => {
        const nombres = ((data as { proveedor: string }[]) ?? []).map((p) => p.proveedor)
        setProveedoresGuardados([...new Set(nombres)].sort())
      })
  }, [])

  // Para las visitas de HOY (agrupando trabajos por visita_id, igual que en
  // Cuentas por cobrar), busca sus cobros/abono/condonaciones sin importar
  // qué día se registraron — así se sabe cuánto de lo trabajado hoy sigue
  // realmente pendiente, en vez de compararlo con "lo cobrado hoy" (que
  // puede incluir cobros de visitas de otros días).
  useEffect(() => {
    let cancelado = false
    async function calcular() {
      if (trabajos.length === 0) {
        setPendienteTrabajoHoy(0)
        setCondonadoTrabajoHoy(0)
        setCobradoServiciosTrabajoHoy(0)
        setCubiertoPorAbonoHoy(0)
        setCubiertoPorAbonoOtroDia(0)
        setDetalleCobradoOtroDia([])
        return
      }
      const { desde, hasta } = rangoDiaUTC(fecha)
      const esDeHoy = (iso: string) => iso >= desde && iso < hasta

      const grupos = new Map<string, RegistroTrabajo[]>()
      for (const t of trabajos) {
        const clave = t.visita_id ?? t.id
        const lista = grupos.get(clave) ?? []
        lista.push(t)
        grupos.set(clave, lista)
      }
      const visitaIds = [...grupos.keys()]
      const citaIds = [...new Set(trabajos.map((t) => t.cita_id).filter(Boolean))] as string[]
      const [{ data: cobrosData }, { data: citasData }, { data: condonacionesData }] = await Promise.all([
        supabase.from('cobros').select('visita_id, monto, created_at').in('visita_id', visitaIds),
        citaIds.length > 0
          ? supabase.from('citas').select('id, abono, created_at').in('id', citaIds)
          : Promise.resolve({ data: [] as { id: string; abono: number; created_at: string }[] }),
        supabase.from('condonaciones').select('visita_id, monto').in('visita_id', visitaIds)
      ])
      if (cancelado) return
      const cobradoHoyPorVisita = new Map<string, number>()
      const cobradoOtroDiaPorVisita = new Map<string, number>()
      for (const c of (cobrosData as { visita_id: string; monto: number; created_at: string }[]) ?? []) {
        const mapa = esDeHoy(c.created_at) ? cobradoHoyPorVisita : cobradoOtroDiaPorVisita
        mapa.set(c.visita_id, (mapa.get(c.visita_id) ?? 0) + Number(c.monto))
      }
      const condonadoPorVisita = new Map<string, number>()
      for (const c of (condonacionesData as { visita_id: string; monto: number }[]) ?? []) {
        condonadoPorVisita.set(c.visita_id, (condonadoPorVisita.get(c.visita_id) ?? 0) + Number(c.monto))
      }
      // El abono se paga al crear la cita, así que su "día" es el de creación.
      const abonoPorCita = new Map<string, { monto: number; hoy: boolean; creadoEn: string }>()
      for (const c of (citasData as { id: string; abono: number; created_at: string }[]) ?? []) {
        abonoPorCita.set(c.id, { monto: Number(c.abono), hoy: esDeHoy(c.created_at), creadoEn: c.created_at })
      }
      let pendiente = 0
      let condonado = 0
      // Dos bolsas separadas, sin importar qué día se movió el dinero: lo
      // que es cobro real de servicios/productos, y lo que es abono de
      // cita. Un abono NUNCA entra a la bolsa de servicios, venga del
      // módulo que venga (clienta agendando sola, admin o dueña agendando).
      let cobradoServicios = 0
      let abonoDeHoy = 0
      let abonoDeOtroDia = 0
      const detalle: { clienteNombre: string; monto: number; detalle: string }[] = []
      for (const [visitaId, regs] of grupos) {
        const total = regs.reduce((s, r) => s + Number(r.precio_cobrado), 0)
        const citaId = regs[0].cita_id
        const abonoInfo = citaId ? abonoPorCita.get(citaId) : undefined
        const abono = abonoInfo?.monto ?? 0
        const cobradoHoy = cobradoHoyPorVisita.get(visitaId) ?? 0
        const cobradoOtro = cobradoOtroDiaPorVisita.get(visitaId) ?? 0
        const cond = condonadoPorVisita.get(visitaId) ?? 0
        const clienteNombre = regs[0].cliente_nombre || 'Sin nombre'
        if (abonoInfo && !abonoInfo.hoy && abonoInfo.monto > 0) {
          detalle.push({ clienteNombre, monto: abonoInfo.monto, detalle: `abono del ${abonoInfo.creadoEn.slice(0, 10)}` })
        }
        if (cobradoOtro > 0) {
          detalle.push({ clienteNombre, monto: cobradoOtro, detalle: 'cobro registrado otro día' })
        }
        pendiente += Math.max(0, total - abono - cobradoHoy - cobradoOtro - cond)
        condonado += cond
        cobradoServicios += cobradoHoy + cobradoOtro
        if (abonoInfo?.hoy) abonoDeHoy += abono
        else abonoDeOtroDia += abono
      }
      setPendienteTrabajoHoy(pendiente)
      setCondonadoTrabajoHoy(condonado)
      setCobradoServiciosTrabajoHoy(cobradoServicios)
      setCubiertoPorAbonoHoy(abonoDeHoy)
      setCubiertoPorAbonoOtroDia(abonoDeOtroDia)
      setDetalleCobradoOtroDia(detalle)
    }
    calcular()
    return () => { cancelado = true }
  }, [trabajos, fecha])

  const totalTrabajos = trabajos.reduce((s, t) => s + Number(t.precio_cobrado), 0)

  // Cobrado del día por medio de pago, SEPARADO por cuadre: lo cobrado en
  // servicios/productos (cobros) por un lado, y los abonos de citas por
  // otro -- antes se sumaban en un solo número y era imposible auditar cada
  // pieza contra lo que se anota aparte.
  const porMetodoServicios = sumaPorMetodo(cobros, (c) => c.metodo_pago, (c) => Number(c.monto))
  const totalCobradoServicios = Object.values(porMetodoServicios).reduce((s, v) => s + v, 0)
  const porMetodoAbonos = sumaPorMetodo(citasConAbono, (c) => c.abono_metodo_pago, (c) => Number(c.abono))
  // El total sale de la lista completa, NO de sumar los 5 medios: un abono
  // guardado sin medio de pago (datos viejos, o una cita creada antes de que
  // el medio fuera obligatorio) no cae en ninguna columna y desaparecería
  // del total, dejando un descuadre imposible de rastrear.
  const totalCobradoAbonos = citasConAbono.reduce((s, c) => s + Number(c.abono), 0)
  const abonosSinMedio = citasConAbono
    .filter((c) => !c.abono_metodo_pago)
    .reduce((s, c) => s + Number(c.abono), 0)

  // Préstamos del día: lo dado (sale de caja) y lo pagado/recibido (entra a
  // caja). Son movimientos del cuadre de servicios -- no tienen relación
  // con los abonos de citas.
  const prestadoHoyPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
  let prestadoHoySinMedio = 0
  for (const p of prestamosHoy) {
    if (p.metodo_pago) prestadoHoyPorMetodo[p.metodo_pago] += Number(p.monto)
    else prestadoHoySinMedio += Number(p.monto)
  }
  const totalPrestadoHoy = prestamosHoy.reduce((s, p) => s + Number(p.monto), 0)
  const pagoPrestamoHoyPorMetodo = sumaPorMetodo(pagosPrestamoHoy, (pg) => pg.metodo_pago, (pg) => Number(pg.monto))
  const totalPagoPrestamoHoy = pagosPrestamoHoy.reduce((s, pg) => s + Number(pg.monto), 0)

  // Reembolsos a clientas hoy (sale de caja): saldo a favor que se devolvió
  // en efectivo/transferencia en vez de dejarse como crédito.
  const reembolsadoHoyPorMetodo = sumaPorMetodo(reembolsosHoy, (r) => r.metodo_pago, (r) => Number(r.monto))
  const totalReembolsadoHoy = reembolsosHoy.reduce((s, r) => s + Number(r.monto), 0)

  // Prestado pendiente total (persistente, como la Base).
  const totalPrestadoPendiente = useMemo(() => {
    const pagadoPorPrestamo = new Map<string, number>()
    for (const pg of pagosPrestamoTodos) {
      pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
    }
    return prestamosPendientes.reduce(
      (s, p) => s + Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0)),
      0
    )
  }, [prestamosPendientes, pagosPrestamoTodos])

  // Resumen del cuadre de servicios: entrado, salido y base.
  const totalEntradoServicios = totalCobradoServicios + totalPagoPrestamoHoy
  const totalSalidoServicios = Number(proveedorMonto || 0) + totalPrestadoHoy + totalReembolsadoHoy

  // "Esperado" neto por medio de pago del cuadre de SERVICIOS: lo cobrado,
  // más lo que entró por pagos de préstamo, menos lo prestado, lo devuelto
  // a clientas y el pago a proveedores en ese mismo medio (si aplica).
  const esperadoServiciosPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
  for (const m of METODOS_PAGO) {
    esperadoServiciosPorMetodo[m.valor] =
      porMetodoServicios[m.valor]
      + pagoPrestamoHoyPorMetodo[m.valor]
      - prestadoHoyPorMetodo[m.valor]
      - reembolsadoHoyPorMetodo[m.valor]
      - (proveedorMetodo === m.valor ? Number(proveedorMonto || 0) : 0)
  }
  const inputsServiciosPorMetodo: Record<MetodoPago, number> = {
    efectivo: Number(efectivo || 0),
    nequi: Number(nequi || 0),
    daviplata: Number(daviplata || 0),
    datafono: Number(datafono || 0),
    bre_b: Number(breB || 0)
  }

  // "Esperado" del cuadre de ABONOS: no tiene préstamos ni proveedores, así
  // que es directamente lo que se abonó ese día por cada medio.
  const inputsAbonosPorMetodo: Record<MetodoPago, number> = {
    efectivo: Number(aboEfectivo || 0),
    nequi: Number(aboNequi || 0),
    daviplata: Number(aboDaviplata || 0),
    datafono: Number(aboDatafono || 0),
    bre_b: Number(aboBreB || 0)
  }

  // Desfase por medio de pago: compara lo reportado en el/los cierre(s) de
  // este día contra lo que se cobró ese día, para señalar en qué medio
  // específico falta o sobra, en vez de solo un total genérico. Uno para
  // cada cuadre.
  function reportadoPorMetodoDe(cierres: CierreConAdmin[]): Record<MetodoPago, number> {
    const mapa: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
    for (const c of cierres) {
      for (const m of METODOS_PAGO) mapa[m.valor] += campoReportado(c, m.valor)
    }
    return mapa
  }
  const reportadoServiciosPorMetodo = reportadoPorMetodoDe(cierresServiciosDelDia)
  const desfaseServiciosPorMetodo = METODOS_PAGO
    .map((m) => ({ ...m, esperado: porMetodoServicios[m.valor], reportado: reportadoServiciosPorMetodo[m.valor], diferencia: reportadoServiciosPorMetodo[m.valor] - porMetodoServicios[m.valor] }))
    .filter((d) => Math.abs(d.diferencia) > 1)
  const reportadoAbonosPorMetodo = reportadoPorMetodoDe(cierresAbonosDelDia)
  const desfaseAbonosPorMetodo = METODOS_PAGO
    .map((m) => ({ ...m, esperado: porMetodoAbonos[m.valor], reportado: reportadoAbonosPorMetodo[m.valor], diferencia: reportadoAbonosPorMetodo[m.valor] - porMetodoAbonos[m.valor] }))
    .filter((d) => Math.abs(d.diferencia) > 1)

  async function handleSubmitServicios(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    if (Number(proveedorMonto || 0) > 0 && !proveedorMetodo) {
      setError('Elige el medio de pago del pago a proveedores.')
      return
    }
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      fecha,
      administradora_id: profile.id,
      tipo: 'servicios',
      base: Number(base || 0),
      efectivo_entregado: Number(efectivo || 0),
      nequi_reportado: Number(nequi || 0),
      daviplata_reportado: Number(daviplata || 0),
      datafono_reportado: Number(datafono || 0),
      bre_b_reportado: Number(breB || 0),
      proveedor_monto: Number(proveedorMonto || 0),
      proveedor_metodo_pago: Number(proveedorMonto || 0) > 0 ? proveedorMetodo : null,
      proveedor_nota: proveedorNota || null,
      observaciones: observaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de servicios para esta fecha.'
          : 'No se pudo guardar el cierre de caja: ' + error.message
      )
    } else {
      setMensaje('Cierre de servicios guardado.')
      setBase('')
      setEfectivo('')
      setNequi('')
      setDaviplata('')
      setDatafono('')
      setBreB('')
      setProveedorMonto('')
      setProveedorMetodo('')
      setProveedorNota('')
      setObservaciones('')
      recargarCierresDelDia()
    }
  }

  async function handleSubmitAbonos(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      fecha,
      administradora_id: profile.id,
      tipo: 'abonos',
      efectivo_entregado: Number(aboEfectivo || 0),
      nequi_reportado: Number(aboNequi || 0),
      daviplata_reportado: Number(aboDaviplata || 0),
      datafono_reportado: Number(aboDatafono || 0),
      bre_b_reportado: Number(aboBreB || 0),
      observaciones: aboObservaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de abonos para esta fecha.'
          : 'No se pudo guardar el cierre de abonos: ' + error.message
      )
    } else {
      setMensaje('Cierre de abonos guardado.')
      setAboEfectivo('')
      setAboNequi('')
      setAboDaviplata('')
      setAboDatafono('')
      setAboBreB('')
      setAboObservaciones('')
      recargarCierresDelDia()
    }
  }

  function recargarCierresDelDia() {
    supabase
      .from('cierres_caja')
      .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
      .eq('fecha', fecha)
      .then(({ data }) => {
        const todos = (data as CierreConAdmin[]) ?? []
        setCierresServiciosDelDia(todos.filter((c) => c.tipo === 'servicios'))
        setCierresAbonosDelDia(todos.filter((c) => c.tipo === 'abonos'))
      })
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cierre de caja</h1>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => cambiarTab('servicios')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'servicios' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Servicios y productos
        </button>
        <button
          type="button"
          onClick={() => cambiarTab('abonos')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'abonos' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Abonos
        </button>
      </div>

      {totalPrestadoPendiente > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Prestado (pendiente de pago)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestadoPendiente)}</p>
        </div>
      )}

      {tab === 'servicios' ? (
        <>
          {/* Resumen: todos los trabajos completados del día */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Trabajos completados del día</h2>
              <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalTrabajos)}</span>
            </div>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {trabajos.map((t) => (
                <li key={t.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                  <span className="min-w-0 truncate">{t.empleada?.nombre} · {t.servicio?.nombre} · {t.cliente_nombre || 'Sin nombre'}</span>
                  <span className="font-medium shrink-0">{pesos(Number(t.precio_cobrado))}</span>
                </li>
              ))}
              {trabajos.length === 0 && <li className="text-sm text-gray-400">Sin trabajos registrados este día.</li>}
            </ul>
            {trabajos.length > 0 && (
              <p className="text-xs text-gray-500 border-t border-gray-100 mt-2 pt-2">
                Cobrado en servicios {pesos(cobradoServiciosTrabajoHoy)}
                {cubiertoPorAbonoHoy > 0 && (
                  <> · <span className="text-purple-700">abono pagado hoy {pesos(cubiertoPorAbonoHoy)} (está en la pestaña «Abonos» de hoy)</span></>
                )}
                {cubiertoPorAbonoOtroDia > 0 && (
                  <> · <span className="text-purple-700">abono pagado otro día {pesos(cubiertoPorAbonoOtroDia)} (está en la pestaña «Abonos» de ese día — ver detalle abajo)</span></>
                )}
                {pendienteTrabajoHoy > 0 && <> · <span className="text-amber-700 font-medium">pendiente {pesos(pendienteTrabajoHoy)}</span></>}
                {condonadoTrabajoHoy > 0 && <> · eliminado {pesos(condonadoTrabajoHoy)}</>}
              </p>
            )}
            {detalleCobradoOtroDia.length > 0 && (
              <ul className="text-[11px] text-gray-400 pl-3 mt-0.5 space-y-0.5">
                {detalleCobradoOtroDia.map((d, i) => (
                  <li key={i}>{d.clienteNombre}: {pesos(d.monto)} ({d.detalle})</li>
                ))}
              </ul>
            )}
          </div>

          {/* Lo cobrado del día por cada medio, solo servicios/productos (Cuentas por cobrar) */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Cobrado de servicios y productos</h2>
              <span className="text-sm font-semibold text-brand-700">{pesos(totalCobradoServicios)}</span>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {METODOS_PAGO.map((m) => (
                <li key={m.valor} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <span>{m.etiqueta}</span>
                  <span className="font-medium">{pesos(porMetodoServicios[m.valor])}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 mt-2">
              Solo los cobros registrados en «Cuentas por cobrar» — los abonos de citas están en la pestaña «Abonos».
            </p>
            {corteAyerHoraServicios && (
              <p className="text-xs text-amber-700 mt-1">
                Incluye lo movido ayer después de las {horaLocal(corteAyerHoraServicios)} — entró cuando la caja de ayer ya estaba cerrada.
              </p>
            )}
            {corteHoyHoraServicios && (
              <p className="text-xs text-amber-700 mt-1">
                No incluye lo movido después de las {horaLocal(corteHoyHoraServicios)} de hoy — como ya se cerró la caja, eso se cuenta para el cierre de mañana.
              </p>
            )}
          </div>

          {/* Préstamos del día: lo dado y lo recibido de vuelta */}
          {(totalPrestadoHoy > 0 || totalPagoPrestamoHoy > 0) && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <h2 className="text-sm font-semibold text-gray-600">Préstamos del día</h2>
              {totalPrestadoHoy > 0 && (
                <div>
                  <p className="text-xs text-gray-500">Dado hoy (sale de caja): <b className="text-red-600">{pesos(totalPrestadoHoy)}</b></p>
                  <ul className="grid grid-cols-2 gap-1 mt-1">
                    {METODOS_PAGO.map((m) => prestadoHoyPorMetodo[m.valor] > 0 && (
                      <li key={m.valor} className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                        <span>{m.etiqueta}</span><span className="font-medium">{pesos(prestadoHoyPorMetodo[m.valor])}</span>
                      </li>
                    ))}
                    {prestadoHoySinMedio > 0 && (
                      <li className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                        <span>Sin medio</span><span className="font-medium">{pesos(prestadoHoySinMedio)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {totalPagoPrestamoHoy > 0 && (
                <div>
                  <p className="text-xs text-gray-500">Pagado/recibido hoy (entra a caja): <b className="text-green-600">{pesos(totalPagoPrestamoHoy)}</b></p>
                  <ul className="grid grid-cols-2 gap-1 mt-1">
                    {METODOS_PAGO.map((m) => pagoPrestamoHoyPorMetodo[m.valor] > 0 && (
                      <li key={m.valor} className="flex justify-between text-xs bg-green-50 rounded-lg px-2 py-1">
                        <span>{m.etiqueta}</span><span className="font-medium">{pesos(pagoPrestamoHoyPorMetodo[m.valor])}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Reembolsos a clientas: saldo a favor que se devolvió en vez de dejarse como crédito */}
          {totalReembolsadoHoy > 0 && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <h2 className="text-sm font-semibold text-gray-600">Reembolsos a clientas hoy</h2>
              <p className="text-xs text-gray-500">Sale de caja: <b className="text-red-600">{pesos(totalReembolsadoHoy)}</b></p>
              <ul className="grid grid-cols-2 gap-1">
                {METODOS_PAGO.map((m) => reembolsadoHoyPorMetodo[m.valor] > 0 && (
                  <li key={m.valor} className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                    <span>{m.etiqueta}</span><span className="font-medium">{pesos(reembolsadoHoyPorMetodo[m.valor])}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-400">Saldo a favor de una clienta (abonó más de lo que terminó costando el servicio) que se devolvió en vez de dejarse como crédito. Se resuelve en «Cuentas por cobrar».</p>
            </div>
          )}

          {esSuperadmin && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-600">Reporte del día — servicios</h2>
              {cierresServiciosDelDia.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Aún no se ha hecho el cierre de servicios de este día.
                </p>
              ) : (
                cierresServiciosDelDia.map((c) => (
                  <div key={c.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-gray-400">Cerrado por {c.administradora?.nombre ?? 'admin'}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-gray-50 rounded-lg py-2">
                        <p className="text-[11px] text-gray-500">Base</p>
                        <p className="text-sm font-semibold">{pesos(Number(c.base))}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg py-2">
                        <p className="text-[11px] text-green-700">Entrado</p>
                        <p className="text-sm font-semibold text-green-700">
                          {pesos(METODOS_PAGO.reduce((s, m) => s + campoReportado(c, m.valor), 0))}
                        </p>
                      </div>
                      <div className="bg-red-50 rounded-lg py-2">
                        <p className="text-[11px] text-red-700">Salido</p>
                        <p className="text-sm font-semibold text-red-700">
                          {pesos(Number(c.proveedor_monto) + totalPrestadoHoy + totalReembolsadoHoy)}
                        </p>
                      </div>
                    </div>
                    <ul className="grid grid-cols-2 gap-1 text-xs">
                      {METODOS_PAGO.map((m) => (
                        <li key={m.valor} className="flex justify-between bg-gray-50 rounded-lg px-2 py-1">
                          <span>{m.etiqueta}</span>
                          <span className="font-medium">{pesos(campoReportado(c, m.valor))}</span>
                        </li>
                      ))}
                    </ul>
                    {Number(c.proveedor_monto) > 0 && (
                      <p className="text-xs text-gray-500">
                        Pago a proveedores: {pesos(Number(c.proveedor_monto))}
                        {c.proveedor_metodo_pago ? ` (${c.proveedor_metodo_pago})` : ''}
                        {c.proveedor_nota ? ` · ${c.proveedor_nota}` : ''}
                      </p>
                    )}
                    {c.observaciones && <p className="text-xs text-gray-500">Obs: {c.observaciones}</p>}
                    <p className="text-sm font-semibold text-brand-700 text-center pt-1">
                      Cierre registrado correctamente ✓
                    </p>
                  </div>
                ))
              )}

              {cierresServiciosDelDia.length > 1 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ⚠ Hay {cierresServiciosDelDia.length} cierres de servicios para este día — se están sumando en la comparación de abajo.
                </p>
              )}

              {cierresServiciosDelDia.length > 0 && (
                desfaseServiciosPorMetodo.length > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
                    <p className="text-xs font-medium text-amber-800">Desfase por medio de pago:</p>
                    {desfaseServiciosPorMetodo.map((d) => (
                      <p key={d.valor} className="text-xs text-amber-700">
                        {d.etiqueta}: reportado {pesos(d.reportado)}, esperado {pesos(d.esperado)} →{' '}
                        <b>{d.diferencia > 0 ? `sobran ${pesos(d.diferencia)}` : `faltan ${pesos(-d.diferencia)}`}</b>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
                    ✓ Lo reportado coincide con lo cobrado ese día, medio por medio.
                  </p>
                )
              )}
            </div>
          )}

          {/* Admin lo usa a diario. Superadmin lo usa cuando ella misma asume la
              caja (a veces la cuadra al día siguiente, cambiando la fecha de
              arriba) o para corregir un cierre mal hecho — queda como un
              registro nuevo aparte, sin borrar ni editar el anterior. */}
          <form onSubmit={handleSubmitServicios} className="bg-white rounded-2xl shadow p-4 space-y-4">
              {esSuperadmin && (
                <p className="text-xs text-gray-400">
                  Como dueña puedes hacer tu propio cierre de cualquier fecha (por ejemplo si tú manejaste la caja
                  ese día) o corregir uno mal hecho — quedará como un registro nuevo, sin borrar el anterior.
                </p>
              )}
              {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
              {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

              <div>
                <label className="block text-sm font-medium mb-1">Base (efectivo inicial)</label>
                <input
                  type="text" inputMode="numeric"
                  value={formatearPesosInput(base)}
                  onChange={(e) => setBase(soloDigitos(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Efectivo</label>
                  <input
                    type="text" inputMode="numeric" required
                    value={formatearPesosInput(efectivo)}
                    onChange={(e) => setEfectivo(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nequi</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(nequi)}
                    onChange={(e) => setNequi(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Daviplata</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(daviplata)}
                    onChange={(e) => setDaviplata(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Datáfono</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(datafono)}
                    onChange={(e) => setDatafono(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bre-B</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(breB)}
                    onChange={(e) => setBreB(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>

              <p className="text-sm font-medium text-brand-700">
                Total reportado: {pesos(Number(efectivo || 0) + Number(nequi || 0) + Number(daviplata || 0) + Number(datafono || 0) + Number(breB || 0))}
              </p>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
                {METODOS_PAGO.map((m) => {
                  const esperado = esperadoServiciosPorMetodo[m.valor]
                  const escrito = inputsServiciosPorMetodo[m.valor]
                  const diferencia = escrito - esperado
                  const coincide = Math.abs(diferencia) < 1
                  return (
                    <p key={m.valor} className={`text-xs ${escrito === 0 ? 'text-gray-500' : coincide ? 'text-green-700' : 'text-amber-700'}`}>
                      {m.etiqueta}: esperado {pesos(esperado)}
                      {escrito > 0 && (
                        coincide
                          ? ' · coincide ✓'
                          : ` · escribiste ${pesos(escrito)} → ${diferencia > 0 ? `sobran ${pesos(diferencia)}` : `faltan ${pesos(-diferencia)}`}`
                      )}
                    </p>
                  )
                })}
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <h3 className="text-sm font-semibold text-gray-600">Pago a proveedores (opcional)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Monto pagado</label>
                    <input
                      type="text" inputMode="numeric"
                      value={formatearPesosInput(proveedorMonto)}
                      onChange={(e) => setProveedorMonto(soloDigitos(e.target.value))}
                      placeholder="0"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Medio de pago</label>
                    <select
                      value={proveedorMetodo}
                      onChange={(e) => setProveedorMetodo(e.target.value)}
                      disabled={!(Number(proveedorMonto || 0) > 0)}
                      required={Number(proveedorMonto || 0) > 0}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <option value="">{Number(proveedorMonto || 0) > 0 ? 'Selecciona…' : '(sin pago)'}</option>
                      {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                    </select>
                  </div>
                </div>
                {Number(proveedorMonto || 0) > 0 && (
                  <>
                    <input
                      value={proveedorNota}
                      onChange={(e) => setProveedorNota(e.target.value)}
                      placeholder="¿A quién / por qué? (opcional)"
                      list="proveedores-datalist"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <datalist id="proveedores-datalist">
                      {proveedoresGuardados.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </>
                )}
              </div>

              <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-gray-500">Base</p>
                  <p className="text-sm font-semibold">{pesos(Number(base || 0))}</p>
                </div>
                <div>
                  <p className="text-[11px] text-green-700">Entrado</p>
                  <p className="text-sm font-semibold text-green-700">{pesos(totalEntradoServicios)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-red-700">Salido</p>
                  <p className="text-sm font-semibold text-red-700">{pesos(totalSalidoServicios)}</p>
                </div>
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
                {guardando ? 'Guardando…' : 'Guardar cierre de servicios'}
              </button>
            </form>
        </>
      ) : (
        <>
          {/* Abonos de citas cobrados este día, itemizados, para poder
              cruzarlos uno por uno contra lo que se anota aparte -- lo que
              antes causaba la confusión (un solo número mezclado con lo de
              servicios). */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Abonos de citas cobrados hoy</h2>
              <span className="text-sm font-semibold text-brand-700">{pesos(totalCobradoAbonos)}</span>
            </div>
            <ul className="grid grid-cols-2 gap-2 mb-3">
              {METODOS_PAGO.map((m) => (
                <li key={m.valor} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <span>{m.etiqueta}</span>
                  <span className="font-medium">{pesos(porMetodoAbonos[m.valor])}</span>
                </li>
              ))}
              {abonosSinMedio > 0 && (
                <li className="flex justify-between text-sm bg-amber-50 rounded-lg px-3 py-2">
                  <span className="text-amber-800">Sin medio</span>
                  <span className="font-medium text-amber-800">{pesos(abonosSinMedio)}</span>
                </li>
              )}
            </ul>
            <ul className="space-y-1 max-h-56 overflow-y-auto border-t border-gray-100 pt-2">
              {citasConAbono.map((c) => (
                <li key={c.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                  <span className="min-w-0 truncate">
                    {c.cliente_nombre || 'Sin nombre'}
                    {c.abono_metodo_pago ? ` · ${METODOS_PAGO.find((m) => m.valor === c.abono_metodo_pago)?.etiqueta}` : ' · sin medio'}
                    {c.fecha !== fecha && <span className="text-gray-400"> (cita del {c.fecha})</span>}
                  </span>
                  <span className="font-medium shrink-0">{pesos(Number(c.abono))}</span>
                </li>
              ))}
              {citasConAbono.length === 0 && <li className="text-sm text-gray-400">Sin abonos este día.</li>}
            </ul>
            <p className="text-xs text-gray-400 mt-2">
              Solo abonos de citas — lo cobrado en servicios y productos está en la pestaña «Servicios y productos».
            </p>
            {corteAyerHoraAbonos && (
              <p className="text-xs text-amber-700 mt-1">
                Incluye lo abonado ayer después de las {horaLocal(corteAyerHoraAbonos)} — entró cuando el cuadre de abonos de ayer ya estaba cerrado.
              </p>
            )}
            {corteHoyHoraAbonos && (
              <p className="text-xs text-amber-700 mt-1">
                No incluye lo movido después de las {horaLocal(corteHoyHoraAbonos)} de hoy — como ya se cerró este cuadre, eso se cuenta para el de mañana.
              </p>
            )}
          </div>

          {esSuperadmin && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-600">Reporte del día — abonos</h2>
              {cierresAbonosDelDia.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Aún no se ha hecho el cierre de abonos de este día.
                </p>
              ) : (
                cierresAbonosDelDia.map((c) => (
                  <div key={c.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-gray-400">Cerrado por {c.administradora?.nombre ?? 'admin'}</p>
                    <p className="text-center text-sm font-semibold text-brand-700">
                      Reportado: {pesos(METODOS_PAGO.reduce((s, m) => s + campoReportado(c, m.valor), 0))}
                    </p>
                    <ul className="grid grid-cols-2 gap-1 text-xs">
                      {METODOS_PAGO.map((m) => (
                        <li key={m.valor} className="flex justify-between bg-gray-50 rounded-lg px-2 py-1">
                          <span>{m.etiqueta}</span>
                          <span className="font-medium">{pesos(campoReportado(c, m.valor))}</span>
                        </li>
                      ))}
                    </ul>
                    {c.observaciones && <p className="text-xs text-gray-500">Obs: {c.observaciones}</p>}
                    <p className="text-sm font-semibold text-brand-700 text-center pt-1">
                      Cierre registrado correctamente ✓
                    </p>
                  </div>
                ))
              )}

              {cierresAbonosDelDia.length > 1 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ⚠ Hay {cierresAbonosDelDia.length} cierres de abonos para este día — se están sumando en la comparación de abajo.
                </p>
              )}

              {cierresAbonosDelDia.length > 0 && (
                desfaseAbonosPorMetodo.length > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
                    <p className="text-xs font-medium text-amber-800">Desfase por medio de pago:</p>
                    {desfaseAbonosPorMetodo.map((d) => (
                      <p key={d.valor} className="text-xs text-amber-700">
                        {d.etiqueta}: reportado {pesos(d.reportado)}, esperado {pesos(d.esperado)} →{' '}
                        <b>{d.diferencia > 0 ? `sobran ${pesos(d.diferencia)}` : `faltan ${pesos(-d.diferencia)}`}</b>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
                    ✓ Lo reportado coincide con lo abonado ese día, medio por medio.
                  </p>
                )
              )}
            </div>
          )}

          <form onSubmit={handleSubmitAbonos} className="bg-white rounded-2xl shadow p-4 space-y-4">
              {esSuperadmin && (
                <p className="text-xs text-gray-400">
                  Como dueña puedes hacer tu propio cierre de abonos de cualquier fecha, o corregir uno mal hecho —
                  quedará como un registro nuevo, sin borrar el anterior.
                </p>
              )}
              {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
              {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Efectivo</label>
                  <input
                    type="text" inputMode="numeric" required
                    value={formatearPesosInput(aboEfectivo)}
                    onChange={(e) => setAboEfectivo(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nequi</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboNequi)}
                    onChange={(e) => setAboNequi(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Daviplata</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboDaviplata)}
                    onChange={(e) => setAboDaviplata(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Datáfono</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboDatafono)}
                    onChange={(e) => setAboDatafono(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bre-B</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboBreB)}
                    onChange={(e) => setAboBreB(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>

              <p className="text-sm font-medium text-brand-700">
                Total reportado: {pesos(Number(aboEfectivo || 0) + Number(aboNequi || 0) + Number(aboDaviplata || 0) + Number(aboDatafono || 0) + Number(aboBreB || 0))}
              </p>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
                {METODOS_PAGO.map((m) => {
                  const esperado = porMetodoAbonos[m.valor]
                  const escrito = inputsAbonosPorMetodo[m.valor]
                  const diferencia = escrito - esperado
                  const coincide = Math.abs(diferencia) < 1
                  return (
                    <p key={m.valor} className={`text-xs ${escrito === 0 ? 'text-gray-500' : coincide ? 'text-green-700' : 'text-amber-700'}`}>
                      {m.etiqueta}: esperado {pesos(esperado)}
                      {escrito > 0 && (
                        coincide
                          ? ' · coincide ✓'
                          : ` · escribiste ${pesos(escrito)} → ${diferencia > 0 ? `sobran ${pesos(diferencia)}` : `faltan ${pesos(-diferencia)}`}`
                      )}
                    </p>
                  )
                })}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Observaciones</label>
                <textarea
                  value={aboObservaciones}
                  onChange={(e) => setAboObservaciones(e.target.value)}
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
                {guardando ? 'Guardando…' : 'Guardar cierre de abonos'}
              </button>
            </form>
        </>
      )}
    </div>
  )
}
