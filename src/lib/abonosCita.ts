import { supabase } from './supabaseClient'

// Una cita puede tener, además del abono con que se agendó (citas.abono),
// abonos adicionales pagados después (tabla cita_abonos). Cualquier pantalla
// que necesite "cuánto ha abonado en total esta clienta" tiene que sumar las
// dos cosas -- si solo lee citas.abono, cobra de más.
//
// OJO: esto es para lo que la clienta DEBE. Para cuadrar la caja por día NO
// se usa: ahí cada abono adicional cuenta el día y con el medio en que entró,
// no el día en que se creó la cita.
export async function adicionalesPorCita(citaIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  if (citaIds.length === 0) return mapa
  const { data } = await supabase.from('cita_abonos').select('cita_id, monto').in('cita_id', citaIds)
  for (const a of (data as { cita_id: string; monto: number }[]) ?? []) {
    mapa.set(a.cita_id, (mapa.get(a.cita_id) ?? 0) + Number(a.monto))
  }
  return mapa
}
