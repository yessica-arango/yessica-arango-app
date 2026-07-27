export type Rol = 'superadmin' | 'admin' | 'personal' | 'cliente'

export type Especialidad = 'manicurista' | 'estilista' | 'lashista'

export const ESPECIALIDADES: { valor: Especialidad; etiqueta: string }[] = [
  { valor: 'manicurista', etiqueta: 'Manicurista' },
  { valor: 'estilista', etiqueta: 'Estilista' },
  { valor: 'lashista', etiqueta: 'Lashista' }
]

export type MetodoPago = 'efectivo' | 'nequi' | 'daviplata' | 'datafono'

export const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'nequi', etiqueta: 'Nequi' },
  { valor: 'daviplata', etiqueta: 'Daviplata' },
  { valor: 'datafono', etiqueta: 'Datáfono' }
]

export interface Profile {
  id: string
  nombre: string
  rol: Rol
  especialidades: Especialidad[]
  telefono: string | null
  apellidos: string | null
  direccion: string | null
  cedula: string | null
  correo: string | null
  fecha_nacimiento: string | null
  fecha_ingreso: string | null
  activo: boolean
  created_at: string
}

export type TipoPermiso = 'permiso' | 'descanso'
export type EstadoPermiso = 'pendiente' | 'aprobado' | 'rechazado'

export interface Permiso {
  id: string
  persona_id: string
  tipo: TipoPermiso
  fecha_desde: string
  fecha_hasta: string
  hora_desde: string | null
  hora_hasta: string | null
  motivo: string | null
  estado: EstadoPermiso
  creado_por: string
  created_at: string
  persona?: Profile
}

export type TipoPrestamo = 'dinero' | 'insumo'

export interface Prestamo {
  id: string
  persona_id: string
  tipo: TipoPrestamo
  descripcion: string | null
  monto: number
  metodo_pago: MetodoPago | null
  pagado: boolean
  producto_id: string | null
  cantidad: number | null
  creado_por: string
  created_at: string
  persona?: Profile
}

// Pago (abono) registrado contra un préstamo: permite pagos parciales,
// cada uno con su medio de pago, para que el cierre de caja los refleje.
export interface PrestamoPago {
  id: string
  prestamo_id: string
  monto: number
  metodo_pago: MetodoPago
  nota: string | null
  pagado_por: string
  created_at: string
}

export type TipoMarcacion = 'entrada' | 'inicio_almuerzo' | 'fin_almuerzo' | 'salida'

export interface Marcacion {
  id: string
  personal_id: string
  tipo: TipoMarcacion
  momento: string
  nota: string | null
  created_at: string
  personal?: Profile
}

export interface Servicio {
  id: string
  categoria: string
  nombre: string
  precio_base: number
  duracion_minutos: number
  activo: boolean
}

export interface RegistroTrabajo {
  id: string
  empleada_id: string
  servicio_id: string
  precio_cobrado: number
  descuento_porcentaje: number
  metodo_pago: MetodoPago | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  foto_url: string | null
  nota: string | null
  visita_id: string | null
  cita_id: string | null
  anulado: boolean
  motivo_anulacion: string | null
  anulado_por: string | null
  anulado_at: string | null
  created_at: string
  servicio?: Servicio
  empleada?: Profile
}

// Cobro registrado por la administradora sobre una visita (cuenta por cobrar).
export interface Cobro {
  id: string
  visita_id: string
  monto: number
  metodo_pago: MetodoPago
  foto_url: string | null
  nota: string | null
  cobrado_por: string
  created_at: string
}

export interface CierreCaja {
  id: string
  fecha: string
  administradora_id: string
  base: number
  efectivo_entregado: number
  nequi_reportado: number
  daviplata_reportado: number
  datafono_reportado: number
  proveedor_monto: number
  proveedor_metodo_pago: MetodoPago | null
  proveedor_nota: string | null
  observaciones: string | null
  created_at: string
}

export type EstadoCita = 'pendiente' | 'confirmada' | 'completada' | 'cancelada'

export interface Cita {
  id: string
  empleada_id: string | null
  servicio_id: string
  servicios_ids: string[]
  cliente_id: string | null
  cliente_nombre: string
  cliente_telefono: string | null
  fecha: string
  hora: string
  hora_fin: string | null
  abono: number
  abono_metodo_pago: MetodoPago | null
  abono_foto_url: string | null
  saldo_pagado: number
  saldo_metodo_pago: MetodoPago | null
  obsequio: string | null
  nota: string | null
  adicional_concepto: string | null
  adicional_valor: number | null
  estado: EstadoCita
  motivo_cancelacion: string | null
  reprogramada: boolean
  creado_por: string
  created_at: string
  servicio?: Servicio
  empleada?: Profile
}

// Producto de inventario (vitrina). Se crea "poco a poco" desde la app.
export interface Producto {
  id: string
  nombre: string
  descripcion: string | null
  precio_venta: number
  costo: number | null
  stock: number
  activo: boolean
  creado_por: string
  created_at: string
}

// Venta de un producto de la vitrina (distinta del préstamo/fiado a empleadas).
export interface Venta {
  id: string
  producto_id: string
  cantidad: number
  precio_unitario: number
  total: number
  cliente_nombre: string | null
  metodo_pago: MetodoPago
  foto_url: string | null
  nota: string | null
  vendido_por: string
  anulado: boolean
  motivo_anulacion: string | null
  anulado_por: string | null
  anulado_at: string | null
  created_at: string
  producto?: Producto
  vendedor?: Profile
}

export interface ComparacionDiaria {
  fecha: string
  total_registrado: number
  total_reportado: number
  diferencia: number
}
