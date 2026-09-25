// Base sobre la que se calcula la comisión de un trabajo.
//
// Normalmente es lo que se le cobró a la clienta, pero hay dos casos que no
// coinciden con la plata:
//   * Garantía: se registra en $0 (la clienta no vuelve a pagar) pero quien la
//     rehizo sí comisiona, por el valor del servicio (valor_comision).
//   * Trabajo al que se le quitó la comisión porque se tuvo que rehacer por
//     garantía: sigue contando como ingreso de su día, pero no comisiona.
export function baseComision(r: {
  precio_cobrado: number | string
  valor_comision?: number | string | null
  comision_anulada?: boolean | null
}): number {
  if (r.comision_anulada) return 0
  return Number(r.valor_comision ?? r.precio_cobrado)
}
