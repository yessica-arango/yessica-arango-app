import type { Cita } from '../types'

function formatearFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number)
  const periodo = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${periodo}`
}

export function mensajeCita(cita: Cita): string {
  const lineas = [
    `Manicurista: ${cita.empleada?.nombre ?? 'Por asignar'}`,
    `💅 Servicio: ${cita.servicio?.nombre ?? ''}`,
    `📆 Fecha: ${formatearFecha(cita.fecha)}`,
    `⏰ Hora: ${formatearHora(cita.hora)}`,
    `👩🏻 Clienta: ${cita.cliente_nombre}`,
    `💰 Abono: $${Number(cita.abono).toLocaleString('es-CO')}`
  ]
  if (cita.obsequio) lineas.push(`🎁 Obsequio: ${cita.obsequio}`)
  return lineas.join('\n')
}

function normalizarTelefonoCO(telefono: string): string {
  const soloDigitos = telefono.replace(/\D/g, '')
  if (soloDigitos.startsWith('57')) return soloDigitos
  if (soloDigitos.length === 10) return `57${soloDigitos}`
  return soloDigitos
}

export function linkWhatsApp(cita: Cita): string {
  const texto = encodeURIComponent(mensajeCita(cita))
  if (cita.cliente_telefono) {
    const numero = normalizarTelefonoCO(cita.cliente_telefono)
    return `https://wa.me/${numero}?text=${texto}`
  }
  // Sin teléfono del cliente: abre el selector de chats de WhatsApp
  // (útil para pegarlo en el grupo del equipo en vez de a un cliente puntual).
  return `https://api.whatsapp.com/send?text=${texto}`
}
