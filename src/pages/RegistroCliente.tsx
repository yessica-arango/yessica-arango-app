import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function RegistroCliente() {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<'sesion' | 'confirmar' | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { nombre, telefono } }
    })
    setLoading(false)

    if (error) {
      setError('No se pudo crear la cuenta. ' + (error.message.includes('registered') ? 'Ese correo ya está registrado.' : 'Revisa los datos e intenta de nuevo.'))
      return
    }
    // Si hay sesión, entra directo; si no, hay que confirmar por correo.
    setListo(data.session ? 'sesion' : 'confirmar')
  }

  if (listo === 'sesion') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes entrar y solicitar tu cita.</p>
          <Link to="/portal" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Ir a mi portal</Link>
        </div>
      </div>
    )
  }

  if (listo === 'confirmar') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">Revisa tu correo</p>
          <p className="text-sm text-gray-500">Te enviamos un enlace para confirmar tu cuenta. Después podrás iniciar sesión.</p>
          <Link to="/login" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Volver al inicio</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="text-center">
          <img src="/logo.png" alt="Yessica Arango" className="w-24 h-24 mx-auto object-contain" />
          <h1 className="text-lg font-semibold text-brand-700 mt-2">Crea tu cuenta</h1>
          <p className="text-sm text-gray-500">Para pedir tus citas fácilmente</p>
        </div>

        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Nombre completo</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Correo</label>
          <input type="email" required autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>

        <p className="text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-brand-600 font-medium">Inicia sesión</Link>
        </p>
      </form>
    </div>
  )
}
