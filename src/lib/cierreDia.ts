import { supabase } from './supabaseClient'
import { fechaLocal, rangoDiaUTC } from './fechas'
import type { TipoCierreCaja } from '../types'

// Si ya existe un cierre de caja para un día, todo lo que se registre
// DESPUÉS de ese cierre (aunque el calendario siga marcando ese mismo día)
// cuenta para el cierre del día siguiente, no para el que ya se cerró. Este
// rango "efectivo" reemplaza el rango de calendario puro en las pantallas
// que suman cobros/abonos/préstamos por día.
// El corte es por tipo de cuadre: cerrar el cuadre de "servicios" no debe
// cortar el de "abonos" (son dos cuadres independientes), así que cada uno
// mira solo sus propios cierres anteriores.
export async function rangoDiaEfectivo(fecha: string, tipo: TipoCierreCaja = 'servicios'): Promise<{ desde: string; hasta: string }> {
  const { desde: desdeDia, hasta: hastaDia } = rangoDiaUTC(fecha)

  const diaAnteriorDate = new Date(`${fecha}T00:00:00`)
  diaAnteriorDate.setDate(diaAnteriorDate.getDate() - 1)
  const diaAnterior = fechaLocal(diaAnteriorDate)

  const [{ data: cierresHoy }, { data: cierresAyer }] = await Promise.all([
    supabase.from('cierres_caja').select('created_at').eq('fecha', fecha).eq('tipo', tipo).order('created_at', { ascending: false }).limit(1),
    supabase.from('cierres_caja').select('created_at').eq('fecha', diaAnterior).eq('tipo', tipo).order('created_at', { ascending: false }).limit(1)
  ])

  const corteHoy = cierresHoy?.[0]?.created_at as string | undefined
  const corteAyer = cierresAyer?.[0]?.created_at as string | undefined

  // El corte de ayer solo arrastra su "cola" a hoy si de verdad ocurrió
  // DENTRO de ayer (ej. se cerró a las 8pm y después entró más plata): eso
  // que quedó fuera del cierre de ayer se cuenta hoy.
  //
  // Si el cierre de ayer se hizo HOY (cuadrar el día anterior al día
  // siguiente es normal, la pantalla misma lo ofrece), ese cierre igual
  // cubrió ayer completo — no debe recortarle nada a hoy. Antes la
  // comparación estaba al revés y en ese caso hoy arrancaba a la hora en
  // que se guardó ese cierre, así que todo lo cobrado/abonado hoy antes de
  // esa hora desaparecía de la pantalla sin dejar rastro.
  const arrastreDeAyer = corteAyer && corteAyer < desdeDia ? corteAyer : null

  return {
    desde: arrastreDeAyer ?? desdeDia,
    hasta: corteHoy && corteHoy < hastaDia ? corteHoy : hastaDia
  }
}
