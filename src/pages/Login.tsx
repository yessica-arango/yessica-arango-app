import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Cuando ya hay sesión (recién ingresó o volvió estando logueado),
  // lo mandamos al inicio, que redirige según su rol.
  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizarCorreoOUsuario(usuario),
      password
    })
    setLoading(false)
    if (error) setError('Usuario o contraseña incorrectos.')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="text-center">
          <img src="/logo.png" alt="Yessica Arango" className="w-28 h-28 mx-auto object-contain" />
          <p className="text-sm text-gray-500 mt-2">Ingresa con tu cuenta</p>
        </div>

        {error && (
          <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Usuario o correo</label>
          <input
            type="text"
            required
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Contraseña</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>

        <p className="text-center text-sm text-gray-500">
          ¿Eres clienta?{' '}
          <Link to="/registro-cliente" className="text-brand-600 font-medium">Crea tu cuenta</Link>
        </p>
      </form>
    </div>
  )
}
