// Utilidades de hora "HH:MM".
export function horaAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function minutosAHora(min: number): string {
  const total = ((min % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Hora de término = inicio + duración (minutos).
export function calcularHoraFin(horaInicio: string, duracionMin: number): string {
  return minutosAHora(horaAMinutos(horaInicio) + duracionMin)
}

// "13:00" o "13:00:00" -> "1:00 pm". En pantalla la hora SIEMPRE va en
// formato de 12 horas: el equipo se confundia leyendo 13, 14, 16 y se
// equivocaba de turno. Los <input type="time"> siguen guardando 24h, que es
// lo que exige el navegador -- esto es solo para mostrar.
export function hora12(hora: string | null | undefined): string {
  if (!hora) return ''
  const [h, m] = hora.split(':').map(Number)
  if (Number.isNaN(h)) return hora
  const periodo = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${periodo}`
}
