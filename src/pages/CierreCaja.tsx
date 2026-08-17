import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import { rangoDiaEfectivo } from '../lib/cierreDia'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { comprimirImagen } from '../lib/comprimirImagen'
import {
  METODOS_PAGO,
  type Cita,
  type CierreCaja as CierreCajaTipo,
  type Cobro,
  type Consignacion,
  type CreditoCliente,
  type Gasto,
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

// Una salida de dinero que quedó guardada sin medio de pago. Se corrige
// asignándole el medio; la tabla dice de dónde salió para poder arreglarla.
interface SalidaSinMedio {
  clave: string
  tabla: 'prestamos' | 'comision_pagos' | 'creditos_clientes'
  id: string
  monto: number
  etiqueta: string
  fecha: string
}

// Una venta de vitrina con sus pagos. Las ventas nuevas registran el pago en
// venta_pagos (permite varios medios); las viejas, de antes de esa tabla,
// solo tienen ventas.metodo_pago -- por eso el fallback, o las ventas
// históricas desaparecerían del cuadre.
interface VentaConPagos {
  id: string
  total: number
  metodo_pago: MetodoPago | null
  pagos: { monto: number; metodo_pago: MetodoPago }[]
}

// Los medios y montos con los que realmente se pagó una venta.
function pagosDeVenta(v: VentaConPagos): { monto: number; metodo_pago: MetodoPago }[] {
  if (v.pagos.length > 0) return v.pagos
  return v.metodo_pago ? [{ monto: Number(v.total), metodo_pago: v.metodo_pago }] : []
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
  // Ventas de vitrina del día con sus pagos. Es plata que entra al cajón
  // igual que un cobro de servicio, así que va en este mismo cuadre -- antes
  // no se consultaba en ningún lado y el "esperado" siempre quedaba corto por
  // el valor de lo vendido, apareciendo como dinero que "sobra".
  const [ventasHoy, setVentasHoy] = useState<VentaConPagos[]>([])
  const [citasConAbono, setCitasConAbono] = useState<Cita[]>([])
  const [prestamosHoy, setPrestamosHoy] = useState<Prestamo[]>([])
  const [pagosPrestamoHoy, setPagosPrestamoHoy] = useState<PrestamoPago[]>([])
  const [reembolsosHoy, setReembolsosHoy] = useState<CreditoCliente[]>([])
  const [gastosHoy, setGastosHoy] = useState<Gasto[]>([])
  const [consignacionesHoy, setConsignacionesHoy] = useState<Consignacion[]>([])

  // Formulario de gasto suelto (compra del día a día, con factura obligatoria).
  const [gastoMonto, setGastoMonto] = useState('')
  const [gastoConcepto, setGastoConcepto] = useState('')
  const [gastoMetodo, setGastoMetodo] = useState('')
  const [gastoFoto, setGastoFoto] = useState<File | null>(null)
  const [gastoError, setGastoError] = useState<string | null>(null)
  const [guardandoGasto, setGuardandoGasto] = useState(false)

  // Formulario de consignación al banco (comprobante obligatorio).
  const [consigMonto, setConsigMonto] = useState('')
  const [consigBanco, setConsigBanco] = useState('')
  const [consigNota, setConsigNota] = useState('')
  const [consigFoto, setConsigFoto] = useState<File | null>(null)
  const [consigError, setConsigError] = useState<string | null>(null)
  const [guardandoConsig, setGuardandoConsig] = useState(false)
  const [abrirConsig, setAbrirConsig] = useState(false)

  // Efectivo pendiente de consignar: histórico completo, no del día. Todo el
  // efectivo que ha entrado menos todo el que ha salido (incluido lo ya
  // consignado). Se cargan los montos con su medio y se filtra en JS.
  const [efectivoMovimientos, setEfectivoMovimientos] = useState<{ entradas: number; salidas: number }>({ entradas: 0, salidas: 0 })
  // Plata que SALIÓ pero quedó guardada sin medio de pago (préstamos,
  // comisiones, reembolsos y pagos a proveedor lo permiten). Si alguna de
  // esas salidas fue en efectivo, no se está restando arriba y el pendiente
  // por consignar queda MÁS ALTO de lo real — por eso se avisa aparte en vez
  // de adivinar que fueron en efectivo.
  const [salidasSinMedio, setSalidasSinMedio] = useState(0)
  // El detalle de esas salidas, para poder asignarles el medio una por una
  // en vez de solo saber que existen.
  const [detalleSinMedio, setDetalleSinMedio] = useState<SalidaSinMedio[]>([])
  const [abrirSinMedio, setAbrirSinMedio] = useState(false)
  const [medioElegido, setMedioElegido] = useState<Record<string, string>>({})
  const [corrigiendoId, setCorrigiendoId] = useState<string | null>(null)
  const [errorSinMedio, setErrorSinMedio] = useState<string | null>(null)
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
        .from('ventas')
        .select('id, total, metodo_pago, pagos:venta_pagos(monto, metodo_pago)')
        .eq('anulado', false)
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .then(({ data }) => setVentasHoy((data as VentaConPagos[]) ?? []))
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
        .from('gastos')
        .select('*')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .order('created_at')
        .then(({ data }) => setGastosHoy((data as Gasto[]) ?? []))
      supabase
        .from('consignaciones')
        .select('*')
        .gte('created_at', rangoServicios.desde)
        .lt('created_at', rangoServicios.hasta)
        .order('created_at')
        .then(({ data }) => setConsignacionesHoy((data as Consignacion[]) ?? []))
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
    cargarEfectivoPendiente()
  }, [])

  // Todo el efectivo que ha entrado a la caja menos todo el que ha salido,
  // desde siempre. Lo que quede es lo que físicamente debería haber para
  // llevar al banco. No descuenta la base: esa se deja en el cajón para dar
  // cambio (se avisa en la tarjeta).
  async function cargarEfectivoPendiente() {
    const esEfectivo = <T extends { metodo_pago: string | null }>(filas: T[] | null) =>
      (filas ?? []).filter((f) => f.metodo_pago === 'efectivo')
    const sumar = <T extends { monto: number }>(filas: T[]) => filas.reduce((s, f) => s + Number(f.monto), 0)

    const [
      { data: cobros }, { data: abonos }, { data: ventaPagos }, { data: pagosPrest },
      { data: cierres }, { data: prestDados }, { data: reemb }, { data: gastosT },
      { data: comisiones }, { data: consig }
    ] = await Promise.all([
      supabase.from('cobros').select('monto, metodo_pago'),
      supabase.from('citas').select('abono, abono_metodo_pago').gt('abono', 0).neq('estado', 'cancelada'),
      supabase.from('venta_pagos').select('monto, metodo_pago'),
      supabase.from('prestamo_pagos').select('monto, metodo_pago'),
      supabase.from('cierres_caja').select('proveedor_monto, proveedor_metodo_pago'),
      supabase.from('prestamos').select('id, monto, metodo_pago, created_at, persona:profiles!prestamos_persona_id_fkey(nombre)').eq('tipo', 'dinero'),
      supabase.from('creditos_clientes').select('id, monto, metodo_pago, created_at').eq('resolucion', 'reembolso'),
      supabase.from('gastos').select('monto, metodo_pago'),
      // Solo los pagos reales: un ajuste de saldo no movió plata, así que no
      // es una salida de caja ni puede quedar como "salida sin medio".
      supabase.from('comision_pagos').select('id, monto, metodo_pago, created_at, persona:profiles!comision_pagos_persona_id_fkey(nombre)').eq('tipo', 'pago'),
      supabase.from('consignaciones').select('monto')
    ])

    const entradas =
      sumar(esEfectivo(cobros as { monto: number; metodo_pago: string | null }[]))
      + sumar(
          ((abonos as { abono: number; abono_metodo_pago: string | null }[]) ?? [])
            .filter((a) => a.abono_metodo_pago === 'efectivo')
            .map((a) => ({ monto: a.abono }))
        )
      + sumar(esEfectivo(ventaPagos as { monto: number; metodo_pago: string | null }[]))
      + sumar(esEfectivo(pagosPrest as { monto: number; metodo_pago: string | null }[]))

    const salidas =
      sumar(
        ((cierres as { proveedor_monto: number; proveedor_metodo_pago: string | null }[]) ?? [])
          .filter((c) => c.proveedor_metodo_pago === 'efectivo')
          .map((c) => ({ monto: c.proveedor_monto }))
      )
      + sumar(esEfectivo(prestDados as { monto: number; metodo_pago: string | null }[]))
      + sumar(esEfectivo(reemb as { monto: number; metodo_pago: string | null }[]))
      + sumar(esEfectivo(gastosT as { monto: number; metodo_pago: string | null }[]))
      + sumar(esEfectivo(comisiones as { monto: number; metodo_pago: string | null }[]))
      // Consignar es sacar el efectivo del cajón: siempre sale, sin medio.
      + sumar((consig as { monto: number }[]) ?? [])

    // Salidas guardadas SIN medio de pago. No se restan arriba (no se puede
    // adivinar si fueron efectivo o transferencia), pero si alguna fue en
    // efectivo el pendiente está sobrado en ese monto -- por eso se avisa.
    const sinMedio = <T extends { metodo_pago: string | null }>(filas: T[] | null) =>
      (filas ?? []).filter((f) => f.metodo_pago === null)
    const sinMedioTotal =
      sumar(sinMedio(prestDados as { monto: number; metodo_pago: string | null }[]))
      + sumar(sinMedio(reemb as { monto: number; metodo_pago: string | null }[]))
      + sumar(sinMedio(comisiones as { monto: number; metodo_pago: string | null }[]))
      + sumar(
          ((cierres as { proveedor_monto: number; proveedor_metodo_pago: string | null }[]) ?? [])
            .filter((c) => c.proveedor_metodo_pago === null && Number(c.proveedor_monto) > 0)
            .map((c) => ({ monto: c.proveedor_monto }))
        )

    // El detalle, para poder corregirlas una por una. El pago a proveedor no
    // entra: vive dentro de un cierre de caja, que es inmutable a propósito
    // (si quedó mal, se corrige haciendo un cierre nuevo).
    // El embed de una relación "a uno" llega como objeto en runtime, pero
    // los tipos generados lo declaran como arreglo -- se normaliza acá.
    type FilaPersona = {
      id: string; monto: number; metodo_pago: string | null; created_at: string
      persona?: { nombre: string } | { nombre: string }[] | null
    }
    const nombreDe = (p: FilaPersona['persona']) =>
      (Array.isArray(p) ? p[0]?.nombre : p?.nombre) ?? 'alguien'
    const comoFilas = (d: unknown) => (d ?? []) as FilaPersona[]

    const detalle: SalidaSinMedio[] = [
      ...sinMedio(comoFilas(prestDados)).map((p) => ({
        clave: `prestamos:${p.id}`, tabla: 'prestamos' as const, id: p.id, monto: Number(p.monto),
        etiqueta: `Préstamo a ${nombreDe(p.persona)}`, fecha: p.created_at.slice(0, 10)
      })),
      ...sinMedio(comoFilas(comisiones)).map((c) => ({
        clave: `comision_pagos:${c.id}`, tabla: 'comision_pagos' as const, id: c.id, monto: Number(c.monto),
        etiqueta: `Comisión pagada a ${nombreDe(c.persona)}`, fecha: c.created_at.slice(0, 10)
      })),
      ...sinMedio(comoFilas(reemb)).map((r) => ({
        clave: `creditos_clientes:${r.id}`, tabla: 'creditos_clientes' as const, id: r.id, monto: Number(r.monto),
        etiqueta: 'Reembolso a clienta', fecha: r.created_at.slice(0, 10)
      }))
    ].sort((a, b) => b.fecha.localeCompare(a.fecha))

    setEfectivoMovimientos({ entradas, salidas })
    setSalidasSinMedio(sinMedioTotal)
    setDetalleSinMedio(detalle)
  }

  const efectivoPendienteConsignar = Math.max(0, efectivoMovimientos.entradas - efectivoMovimientos.salidas)

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
  // Cobros de servicios y ventas de productos son dos cosas distintas que
  // caen en el mismo cajón: se muestran por separado (para poder auditar
  // cada una) pero se suman para el cuadre por medio de pago.
  const pagosDeVentas = ventasHoy.flatMap(pagosDeVenta)
  const porMetodoCobros = sumaPorMetodo(cobros, (c) => c.metodo_pago, (c) => Number(c.monto))
  const porMetodoVentas = sumaPorMetodo(pagosDeVentas, (p) => p.metodo_pago, (p) => Number(p.monto))
  const totalCobrosServicios = cobros.reduce((s, c) => s + Number(c.monto), 0)
  const totalVentasProductos = pagosDeVentas.reduce((s, p) => s + Number(p.monto), 0)
  const porMetodoServicios: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
  for (const m of METODOS_PAGO) porMetodoServicios[m.valor] = porMetodoCobros[m.valor] + porMetodoVentas[m.valor]
  const totalCobradoServicios = totalCobrosServicios + totalVentasProductos
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

  // Gastos y consignaciones del día: también son plata que salió del cajón.
  const gastadoHoyPorMetodo = sumaPorMetodo(gastosHoy, (g) => g.metodo_pago, (g) => Number(g.monto))
  const totalGastadoHoy = gastosHoy.reduce((s, g) => s + Number(g.monto), 0)
  const totalConsignadoHoy = consignacionesHoy.reduce((s, c) => s + Number(c.monto), 0)

  // Resumen del cuadre de servicios: entrado, salido y base.
  const totalEntradoServicios = totalCobradoServicios + totalPagoPrestamoHoy
  const totalSalidoServicios =
    Number(proveedorMonto || 0) + totalPrestadoHoy + totalReembolsadoHoy + totalGastadoHoy + totalConsignadoHoy

  // "Esperado" neto por medio de pago del cuadre de SERVICIOS: lo cobrado,
  // más lo que entró por pagos de préstamo, menos lo prestado, lo devuelto
  // a clientas, los gastos, lo consignado y el pago a proveedores en ese
  // mismo medio (si aplica).
  const esperadoServiciosPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }
  for (const m of METODOS_PAGO) {
    esperadoServiciosPorMetodo[m.valor] =
      porMetodoServicios[m.valor]
      + pagoPrestamoHoyPorMetodo[m.valor]
      - prestadoHoyPorMetodo[m.valor]
      - reembolsadoHoyPorMetodo[m.valor]
      - gastadoHoyPorMetodo[m.valor]
      // Lo consignado sale siempre en efectivo (es sacar la plata del cajón).
      - (m.valor === 'efectivo' ? totalConsignadoHoy : 0)
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

  // Sube la foto comprimida al bucket de evidencias y devuelve su ruta.
  async function subirSoporte(carpeta: string, archivo: File): Promise<string> {
    const comprimida = await comprimirImagen(archivo)
    const path = `${carpeta}/${profile?.id}/${Date.now()}_${comprimida.name}`
    const { error } = await supabase.storage.from('evidencias').upload(path, comprimida)
    if (error) throw error
    return path
  }

  async function registrarGasto(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setGastoError(null)
    const monto = Number(gastoMonto || 0)
    if (monto <= 0) { setGastoError('Escribe el valor del gasto.'); return }
    if (!gastoConcepto.trim()) { setGastoError('Escribe qué se compró.'); return }
    if (!gastoMetodo) { setGastoError('Elige con qué se pagó.'); return }
    if (!gastoFoto) { setGastoError('Sube la foto de la factura.'); return }
    setGuardandoGasto(true)
    try {
      const fotoPath = await subirSoporte('gastos', gastoFoto)
      const { error } = await supabase.from('gastos').insert({
        monto,
        concepto: gastoConcepto.trim(),
        metodo_pago: gastoMetodo,
        foto_url: fotoPath,
        registrado_por: profile.id
      })
      if (error) throw error
      setGastoMonto(''); setGastoConcepto(''); setGastoMetodo(''); setGastoFoto(null)
      cargarDiaGastos()
      cargarEfectivoPendiente()
    } catch (err) {
      setGastoError('No se pudo registrar el gasto: ' + (err as Error).message)
    } finally {
      setGuardandoGasto(false)
    }
  }

  async function registrarConsignacion(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setConsigError(null)
    const monto = Number(consigMonto || 0)
    if (monto <= 0) { setConsigError('Escribe el valor consignado.'); return }
    if (!consigFoto) { setConsigError('Sube la foto del comprobante de la consignación.'); return }
    setGuardandoConsig(true)
    try {
      const fotoPath = await subirSoporte('consignaciones', consigFoto)
      const { error } = await supabase.from('consignaciones').insert({
        monto,
        banco: consigBanco.trim() || null,
        nota: consigNota.trim() || null,
        foto_url: fotoPath,
        registrado_por: profile.id
      })
      if (error) throw error
      setConsigMonto(''); setConsigBanco(''); setConsigNota(''); setConsigFoto(null)
      setAbrirConsig(false)
      cargarDiaGastos()
      cargarEfectivoPendiente()
    } catch (err) {
      setConsigError('No se pudo registrar la consignación: ' + (err as Error).message)
    } finally {
      setGuardandoConsig(false)
    }
  }

  // Recarga solo gastos y consignaciones del día visible (después de agregar
  // uno, sin tener que recargar todo el resto de la pantalla).
  async function cargarDiaGastos() {
    const rango = await rangoDiaEfectivo(fecha, 'servicios')
    supabase.from('gastos').select('*')
      .gte('created_at', rango.desde).lt('created_at', rango.hasta).order('created_at')
      .then(({ data }) => setGastosHoy((data as Gasto[]) ?? []))
    supabase.from('consignaciones').select('*')
      .gte('created_at', rango.desde).lt('created_at', rango.hasta).order('created_at')
      .then(({ data }) => setConsignacionesHoy((data as Consignacion[]) ?? []))
  }

  // Asigna el medio de pago a una salida vieja que quedó sin él. La base
  // solo lo permite si hoy está en nulo y queda lleno: una vez corregida no
  // se puede volver a tocar.
  async function corregirMedio(fila: SalidaSinMedio) {
    const medio = medioElegido[fila.clave]
    if (!medio) return
    setErrorSinMedio(null)
    setCorrigiendoId(fila.clave)
    const { error } = await supabase.from(fila.tabla).update({ metodo_pago: medio }).eq('id', fila.id)
    setCorrigiendoId(null)
    if (error) {
      setErrorSinMedio('No se pudo corregir: ' + error.message)
      return
    }
    setMedioElegido((p) => ({ ...p, [fila.clave]: '' }))
    cargarEfectivoPendiente()
  }

  // Abre un soporte (factura o comprobante) en una pestaña nueva.
  async function verSoporte(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
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

      {/* Alarma de consignación: efectivo acumulado que debería estar en el
          cajón esperando irse al banco. Persistente, no del día. Se muestra
          siempre (incluso en cero) para poder confirmar de un vistazo que ya
          se consignó todo, en vez de que la tarjeta simplemente desaparezca. */}
      <div className={`rounded-2xl p-4 space-y-2 border ${efectivoPendienteConsignar > 0 ? 'bg-blue-50 border-blue-300' : 'bg-green-50 border-green-300'}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-xs ${efectivoPendienteConsignar > 0 ? 'text-blue-700' : 'text-green-700'}`}>
              💰 Efectivo por consignar
            </p>
            <p className={`text-2xl font-bold ${efectivoPendienteConsignar > 0 ? 'text-blue-800' : 'text-green-800'}`}>
              {pesos(efectivoPendienteConsignar)}
            </p>
            {efectivoPendienteConsignar <= 0 && (
              <p className="text-xs text-green-700">✓ Todo el efectivo está consignado. Vuelve a subir a medida que entre plata en efectivo.</p>
            )}
          </div>
          {!abrirConsig && efectivoPendienteConsignar > 0 && (
            <button
              onClick={() => { setAbrirConsig(true); setConsigMonto(String(Math.round(efectivoPendienteConsignar))); setConsigError(null) }}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-3 py-2 shrink-0"
            >
              Registrar consignación
            </button>
          )}
        </div>
        {efectivoPendienteConsignar > 0 && (
          <>
          <p className="text-[11px] text-blue-700">
            <b>Solo billetes y monedas.</b> Cuenta únicamente lo cobrado con el medio «Efectivo» — lo de Nequi,
            Bre-B, Daviplata y Datáfono no entra acá, porque ese dinero ya está en la cuenta.
            Se le resta lo que salió en efectivo (préstamos, gastos, proveedores, comisiones) y lo ya consignado.
            Recuerda dejar la base para dar cambio.
          </p>
          {salidasSinMedio > 0 && (
            <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-2">
              <p>
                ⚠ Hay {pesos(salidasSinMedio)} en salidas (préstamos, comisiones, reembolsos o pagos a proveedor)
                guardados <b>sin medio de pago</b>. Mientras no lo tengan, este pendiente está sobrado en lo que
                de eso haya salido en efectivo.
              </p>
              {esSuperadmin && !abrirSinMedio && detalleSinMedio.length > 0 && (
                <button onClick={() => setAbrirSinMedio(true)} className="underline font-medium">
                  Corregirlas ahora ({detalleSinMedio.length})
                </button>
              )}
              {esSuperadmin && abrirSinMedio && (
                <div className="space-y-1.5">
                  {errorSinMedio && <p className="text-red-700">{errorSinMedio}</p>}
                  {detalleSinMedio.map((f) => (
                    <div key={f.clave} className="bg-white rounded-lg p-2 flex flex-wrap items-center gap-2">
                      <span className="flex-1 min-w-[9rem]">
                        {f.etiqueta} · {pesos(f.monto)} <span className="text-gray-400">({f.fecha})</span>
                      </span>
                      <select
                        value={medioElegido[f.clave] ?? ''}
                        onChange={(e) => setMedioElegido((p) => ({ ...p, [f.clave]: e.target.value }))}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-[11px]"
                      >
                        <option value="">¿Con qué salió?</option>
                        {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                      </select>
                      <button
                        onClick={() => corregirMedio(f)}
                        disabled={!medioElegido[f.clave] || corrigiendoId === f.clave}
                        className="text-[11px] px-2 py-1 rounded-lg bg-brand-600 text-white disabled:opacity-40"
                      >
                        Guardar
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setAbrirSinMedio(false)} className="underline">Cerrar</button>
                  <p className="text-amber-700">
                    El pago a proveedor no sale acá: vive dentro de un cierre de caja, que no se puede editar.
                    Si ese quedó mal, se corrige guardando un cierre nuevo.
                  </p>
                </div>
              )}
            </div>
          )}
          </>
        )}

        {abrirConsig && (
            <form onSubmit={registrarConsignacion} className="bg-white rounded-xl p-3 space-y-2">
              {consigError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{consigError}</div>}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Valor consignado</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(consigMonto)}
                    onChange={(e) => setConsigMonto(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Banco (opcional)</label>
                  <input
                    value={consigBanco}
                    onChange={(e) => setConsigBanco(e.target.value)}
                    placeholder="Ej. Bancolombia"
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Foto del comprobante (obligatoria)</label>
                <input
                  type="file" accept="image/*" required
                  onChange={(e) => setConsigFoto(e.target.files?.[0] ?? null)}
                  className="w-full text-xs"
                />
              </div>
              <input
                value={consigNota}
                onChange={(e) => setConsigNota(e.target.value)}
                placeholder="Nota (opcional)"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={guardandoConsig}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg py-1.5 disabled:opacity-50"
                >
                  {guardandoConsig ? 'Guardando…' : 'Registrar consignación'}
                </button>
                <button
                  type="button"
                  onClick={() => setAbrirConsig(false)}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-medium rounded-lg py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </form>
        )}
      </div>

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
            {/* De los trabajos del día hasta lo que debe estar cobrado ACÁ:
                se va restando lo que se cuadra en otro lado (abonos) o lo que
                no es plata (pendiente, eliminado), hasta llegar a una cifra
                que sí tiene que coincidir con la tarjeta de abajo. */}
            {trabajos.length > 0 && (
              <dl className="text-xs border-t border-gray-100 mt-2 pt-2 space-y-1">
                <div className="flex justify-between text-gray-500">
                  <dt>Valor de los trabajos</dt>
                  <dd>{pesos(totalTrabajos)}</dd>
                </div>
                {cubiertoPorAbonoHoy > 0 && (
                  <div className="flex justify-between text-purple-700">
                    <dt>− Abono pagado hoy <span className="text-purple-400">(cuadra en «Abonos» de hoy)</span></dt>
                    <dd>−{pesos(cubiertoPorAbonoHoy)}</dd>
                  </div>
                )}
                {cubiertoPorAbonoOtroDia > 0 && (
                  <div className="flex justify-between text-purple-700">
                    <dt>− Abono pagado otro día <span className="text-purple-400">(cuadró en «Abonos» de ese día)</span></dt>
                    <dd>−{pesos(cubiertoPorAbonoOtroDia)}</dd>
                  </div>
                )}
                {pendienteTrabajoHoy > 0 && (
                  <div className="flex justify-between text-amber-700 font-medium">
                    <dt>− Pendiente por cobrar</dt>
                    <dd>−{pesos(pendienteTrabajoHoy)}</dd>
                  </div>
                )}
                {condonadoTrabajoHoy > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <dt>− Eliminado (no se cobra)</dt>
                    <dd>−{pesos(condonadoTrabajoHoy)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-gray-700 border-t border-gray-100 pt-1">
                  <dt>= Debe estar cobrado acá</dt>
                  <dd>{pesos(cobradoServiciosTrabajoHoy)}</dd>
                </div>
              </dl>
            )}
            {detalleCobradoOtroDia.length > 0 && (
              <ul className="text-[11px] text-gray-400 pl-3 mt-1 space-y-0.5">
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
            <dl className="text-xs mt-2 pt-2 border-t border-gray-100 space-y-1">
              <div className="flex justify-between text-gray-500">
                <dt>Cobros de servicios</dt>
                <dd>{pesos(totalCobrosServicios)}</dd>
              </div>
              <div className="flex justify-between text-gray-500">
                <dt>Ventas de productos (vitrina)</dt>
                <dd>{pesos(totalVentasProductos)}</dd>
              </div>
            </dl>
            {/* La comprobación que cierra el círculo: lo que los trabajos de
                hoy dicen que debió cobrarse acá vs. lo que de verdad se
                cobró. Si no coinciden, la diferencia son cobros de visitas
                de OTROS días (o de hoy cobrados otro día) -- no un error,
                pero hay que verlo para no perseguir un descuadre fantasma. */}
            {(() => {
              const diferencia = totalCobrosServicios - cobradoServiciosTrabajoHoy
              if (Math.abs(diferencia) < 1) {
                return trabajos.length > 0 ? (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2 mt-2">
                    ✓ Los {pesos(totalCobrosServicios)} de cobros cuadran con los trabajos del día.
                  </p>
                ) : null
              }
              return (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                  Los trabajos de hoy dan {pesos(cobradoServiciosTrabajoHoy)} cobrados, pero hoy se registraron {pesos(totalCobrosServicios)} en cobros
                  — <b>{diferencia > 0 ? `${pesos(diferencia)} de más` : `${pesos(-diferencia)} de menos`}</b>. Suele ser un saldo de una visita de otro día que se cobró hoy (o al revés).
                </p>
              )
            })()}
            <p className="text-xs text-gray-400 mt-2">
              Cobros de «Cuentas por cobrar» + ventas de vitrina — los abonos de citas están en la pestaña «Abonos».
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

          {/* Gastos varios del día: las compras chiquitas que no son un pago
              a proveedor (una copia, unos vasos). Factura obligatoria. */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-600">Gastos y compras del día</h2>
              {totalGastadoHoy > 0 && <span className="text-sm font-semibold text-red-600">-{pesos(totalGastadoHoy)}</span>}
            </div>

            <ul className="space-y-1">
              {gastosHoy.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 text-sm border-b border-gray-50 pb-1">
                  <span className="min-w-0 truncate">
                    {g.concepto}
                    <span className="text-gray-400"> · {METODOS_PAGO.find((m) => m.valor === g.metodo_pago)?.etiqueta}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <button onClick={() => verSoporte(g.foto_url)} className="text-xs text-brand-700 underline">Factura</button>
                    <span className="font-medium">{pesos(Number(g.monto))}</span>
                  </span>
                </li>
              ))}
              {gastosHoy.length === 0 && <li className="text-sm text-gray-400">Sin gastos registrados este día.</li>}
            </ul>

            <form onSubmit={registrarGasto} className="bg-gray-50 rounded-xl p-3 space-y-2">
              {gastoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{gastoError}</div>}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Valor</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(gastoMonto)}
                    onChange={(e) => setGastoMonto(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">¿Con qué se pagó?</label>
                  <select
                    value={gastoMetodo}
                    onChange={(e) => setGastoMetodo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Selecciona…</option>
                    {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                  </select>
                </div>
              </div>
              <input
                value={gastoConcepto}
                onChange={(e) => setGastoConcepto(e.target.value)}
                placeholder="¿Qué se compró? (ej. copias, vasos, taxi)"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <div>
                <label className="block text-xs font-medium mb-1">Foto de la factura (obligatoria)</label>
                <input
                  type="file" accept="image/*"
                  onChange={(e) => setGastoFoto(e.target.files?.[0] ?? null)}
                  className="w-full text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={guardandoGasto}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg py-1.5 disabled:opacity-50"
              >
                {guardandoGasto ? 'Guardando…' : 'Registrar gasto'}
              </button>
              <p className="text-[11px] text-gray-400">
                Para compras sueltas del día a día. Lo que se le paga a un proveedor va abajo, en el formulario del cierre.
              </p>
            </form>
          </div>

          {/* Consignaciones hechas este día */}
          {consignacionesHoy.length > 0 && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-600">Consignaciones del día</h2>
                <span className="text-sm font-semibold text-blue-700">{pesos(totalConsignadoHoy)}</span>
              </div>
              <ul className="space-y-1">
                {consignacionesHoy.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm border-b border-gray-50 pb-1">
                    <span className="min-w-0 truncate">
                      {c.banco ?? 'Banco'}{c.nota ? ` · ${c.nota}` : ''}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <button onClick={() => verSoporte(c.foto_url)} className="text-xs text-brand-700 underline">Comprobante</button>
                      <span className="font-medium">{pesos(Number(c.monto))}</span>
                    </span>
                  </li>
                ))}
              </ul>
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
