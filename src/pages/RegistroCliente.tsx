import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { crearClientaPorTelefono } from '../lib/crearClienta'

export default function RegistroCliente() {
  const [nombre, setNombre] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [telefono, setTelefono] = useState('')
  const [usuario, setUsuario] = useState('')
  const [usuarioAuto, setUsuarioAuto] = useState(true)
  const [password, setPassword] = useState('')
  const [passwordAuto, setPasswordAuto] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<'sesion' | 'confirmar' | null>(null)

  function onTelefonoChange(v: string) {
    setTelefono(v)
    if (usuarioAuto) setUsuario(v)
    if (passwordAuto) setPassword(v)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!telefono.trim()) {
      setError('Escribe tu teléfono.')
      return
    }
    setLoading(true)
    const resultado = await crearClientaPorTelefono(supabase, { nombre, apellidos, telefono, usuario, password })
    setLoading(false)
    if ('error' in resultado) {
      setError(resultado.error)
      return
    }
    setListo(resultado.sesionIniciada ? 'sesion' : 'confirmar')
  }

  if (listo === 'sesion') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes solicitar tu cita. Tu usuario es <b>{usuario}</b>.</p>
          <Link to="/portal" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Ir a mi portal</Link>
        </div>
      </div>
    )
  }

  if (listo === 'confirmar') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 text-center space-y-3">
          <p className="text-brand-700 font-semibold">¡Cuenta creada!</p>
          <p className="text-sm text-gray-500">Ya puedes iniciar sesión con el usuario <b>{usuario}</b> y la contraseña que escribiste.</p>
          <Link to="/login" className="inline-block bg-brand-600 text-white rounded-lg px-4 py-2 text-sm font-medium">Iniciar sesión</Link>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Apellido</label>
            <input value={apellidos} onChange={(e) => setApellidos(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
          <input
            required
            inputMode="numeric"
            value={telefono}
            onChange={(e) => onTelefonoChange(e.target.value)}
            placeholder="3001234567"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Usuario</label>
          <input
            required
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => { setUsuario(e.target.value); setUsuarioAuto(false) }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input
            required
            minLength={6}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordAuto(false) }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <p className="text-xs text-gray-400 mt-1">Se llenan solos con tu teléfono — puedes cambiarlos si quieres.</p>
        </div>

        <button type="submit" disabled={loading} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {loading ? 'Creando…' : 'Crear cuenta'}
        </button>

        <p className="text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-brand-600 font-medium">Inicia sesión</Link>
        </p>
        <p className="text-center text-[11px] text-gray-300">Developed by Vulpex Software SAS</p>
      </form>
    </div>
  )
}
