// Las cuentas internas (Superadmin, dueña, administradora, manicuristas) pueden
// iniciar sesión con un "usuario" corto en vez de un correo. Internamente
// Supabase usa correos, así que a un usuario sin "@" le agregamos este dominio.
export const DOMINIO_INTERNO = 'yessica-arango.app'

export function normalizarCorreoOUsuario(entrada: string): string {
  const valor = entrada.trim()
  if (valor.includes('@')) return valor.toLowerCase()
  return `${valor.toLowerCase()}@${DOMINIO_INTERNO}`
}
