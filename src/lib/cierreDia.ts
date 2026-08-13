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

  return {
    desde: corteAyer && corteAyer > desdeDia ? corteAyer : desdeDia,
    hasta: corteHoy && corteHoy < hastaDia ? corteHoy : hastaDia
  }
}
