import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarCorreoOUsuario } from './authDominio'

// Crea la cuenta de una clienta usando el teléfono como identidad por
// defecto: si no se da usuario/contraseña, se usa el teléfono para ambos
// (recomendado, pero editable en los formularios que llaman a esto).
export async function crearClientaPorTelefono(
  cliente: SupabaseClient,
  opts: { nombre: string; apellidos?: string; telefono: string; usuario?: string; password?: string }
): Promise<{ id: string; sesionIniciada: boolean } | { error: string }> {
  const usuario = (opts.usuario || opts.telefono).trim()
  const password = (opts.password || opts.telefono).trim()
  if (!opts.telefono.trim()) return { error: 'Escribe el teléfono.' }
  if (password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' }

  const email = normalizarCorreoOUsuario(usuario)
  const { data, error } = await cliente.auth.signUp({
    email,
    password,
    options: { data: { nombre: opts.nombre, apellidos: opts.apellidos || null, telefono: opts.telefono } }
  })
  if (error) {
    return {
      error: error.message.toLowerCase().includes('registered') || error.message.toLowerCase().includes('already')
        ? 'Ese usuario ya tiene cuenta.'
        : 'No se pudo crear la clienta: ' + error.message
    }
  }
  if (!data.user?.id) return { error: 'No se pudo crear la clienta.' }
  return { id: data.user.id, sesionIniciada: !!data.session }
}
