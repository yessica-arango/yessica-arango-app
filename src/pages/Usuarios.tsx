import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, crearClienteEfimero } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { ESPECIALIDADES, type Especialidad, type Profile, type Rol } from '../types'

const ROLES: { valor: Rol; etiqueta: string }[] = [
  { valor: 'cliente', etiqueta: 'Clienta' },
  { valor: 'personal', etiqueta: 'Personal (profesional)' },
  { valor: 'admin', etiqueta: 'Admin' },
  { valor: 'superadmin', etiqueta: 'Super Admin (Dueña)' }
]

export default function Usuarios() {
  const { profile } = useAuth()
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [filtro, setFiltro] = useState('')
  const [pestana, setPestana] = useState<'personal' | 'clientes'>('personal')

  // --- Alta de usuario nuevo ---
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [nNombre, setNNombre] = useState('')
  const [nUsuario, setNUsuario] = useState('')
  const [nPassword, setNPassword] = useState('')
  const [nTelefono, setNTelefono] = useState('')
  const [nRol, setNRol] = useState<Rol>('personal')
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase.from('profiles').select('*').order('nombre')
    setPerfiles((data as Profile[]) ?? [])
  }

  useEffect(() => {
    cargar()
  }, [])

  async function crearUsuario(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    setCreando(true)

    const email = normalizarCorreoOUsuario(nUsuario)
    // Cliente efímero: crea la cuenta sin cerrar la sesión del superadmin.
    const efimero = crearClienteEfimero()
    const { data, error: errSignup } = await efimero.auth.signUp({
      email,
      password: nPassword,
      options: { data: { nombre: nNombre, telefono: nTelefono } }
    })

    if (errSignup) {
      setCreando(false)
      setError(
        errSignup.message.toLowerCase().includes('registered') || errSignup.message.toLowerCase().includes('already')
          ? 'Ese usuario/correo ya existe.'
          : 'No se pudo crear el usuario: ' + errSignup.message
      )
      return
    }

    // El trigger creó su perfil como 'cliente'. Le ponemos el rol elegido.
    const nuevoId = data.user?.id
    if (nuevoId) {
      await supabase
        .from('profiles')
        .update({ rol: nRol, nombre: nNombre, telefono: nTelefono || null })
        .eq('id', nuevoId)
    }

    setCreando(false)
    if (!data.session) {
      // La confirmación de correo está activada en Supabase.
      setMensaje(
        'Usuario creado, pero Supabase pide confirmar el correo. Para cuentas internas, desactiva ' +
          '"Confirm email" en Supabase → Authentication → Providers → Email, y vuelve a crearlo.'
      )
    } else {
      setMensaje(`Usuario "${nNombre}" creado. Ya puede iniciar sesión con ${email.split('@')[0]}.`)
    }

    setNNombre('')
    setNUsuario('')
    setNPassword('')
    setNTelefono('')
    setNRol('personal')
    cargar()
  }

  async function cambiarRol(id: string, rol: Rol) {
    await supabase.from('profiles').update({ rol }).eq('id', id)
    cargar()
  }

  async function alternarActivo(p: Profile) {
    if (p.activo && !confirm(`¿Quitar el acceso a ${p.nombre}? No podrá iniciar sesión hasta reactivarla.`)) return
    await supabase.from('profiles').update({ activo: !p.activo }).eq('id', p.id)
    cargar()
  }

  async function alternarEspecialidad(p: Profile, esp: Especialidad) {
    const actuales = p.especialidades ?? []
    const nuevas = actuales.includes(esp)
      ? actuales.filter((e) => e !== esp)
      : [...actuales, esp]
    await supabase.from('profiles').update({ especialidades: nuevas }).eq('id', p.id)
    cargar()
  }

  const esPersonal = (r: Rol) => r === 'superadmin' || r === 'admin' || r === 'personal'
  const conteoPersonal = perfiles.filter((p) => esPersonal(p.rol)).length
  const conteoClientes = perfiles.filter((p) => p.rol === 'cliente').length

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return perfiles.filter((p) => {
      const enGrupo = pestana === 'personal' ? esPersonal(p.rol) : p.rol === 'cliente'
      if (!enGrupo) return false
      if (!f) return true
      return p.nombre.toLowerCase().includes(f) || p.rol.includes(f)
    })
  }, [perfiles, filtro, pestana])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Usuarios</h1>
        <button
          onClick={() => { setMostrarAlta((v) => !v); setError(null); setMensaje(null) }}
          className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg px-3 py-1.5"
        >
          {mostrarAlta ? 'Cerrar' : '+ Crear usuario'}
        </button>
      </div>

      {mostrarAlta && (
        <form onSubmit={crearUsuario} className="bg-white rounded-2xl shadow p-4 space-y-3">
          <h2 className="font-semibold text-sm text-gray-600">Crear usuario</h2>
          {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
          {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nombre</label>
              <input required value={nNombre} onChange={(e) => setNNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Rol</label>
              <select value={nRol} onChange={(e) => setNRol(e.target.value as Rol)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Usuario o correo</label>
            <input
              required
              autoCapitalize="none"
              value={nUsuario}
              onChange={(e) => setNUsuario(e.target.value)}
              placeholder="ej: maria  (o maria@correo.com)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <p className="text-xs text-gray-400 mt-1">
              Si escribes solo un usuario (sin @), entrará escribiendo ese nombre. Si es una clienta con correo real, ponlo completo.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Contraseña</label>
              <input type="text" required minLength={6} value={nPassword} onChange={(e) => setNPassword(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Teléfono (opcional)</label>
              <input value={nTelefono} onChange={(e) => setNTelefono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          <button type="submit" disabled={creando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
            {creando ? 'Creando…' : 'Crear usuario'}
          </button>
        </form>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800 space-y-1">
        <p>
          Puedes <strong>crear usuarios</strong> aquí, cambiarles el <strong>rol</strong> y sus
          <strong> especialidades</strong>, o <strong>quitarles el acceso</strong> (botón verde/gris).
        </p>
        <p>
          Las especialidades son solo una etiqueta: <strong>a cualquier profesional se le puede asignar
          cualquier servicio</strong>, sin importar cómo esté etiquetada.
        </p>
      </div>

      <div className="flex gap-1 bg-white/70 rounded-xl p-1 shadow-sm">
        <button
          onClick={() => setPestana('personal')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'personal' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Personal de la empresa ({conteoPersonal})
        </button>
        <button
          onClick={() => setPestana('clientes')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'clientes' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Clientes ({conteoClientes})
        </button>
      </div>

      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por nombre o rol…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="space-y-3">
        {visibles.map((p) => (
          <div key={p.id} className={`bg-white rounded-2xl shadow p-3 space-y-3 ${p.activo ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {p.nombre}
                  {p.id === profile?.id && <span className="text-brand-500 text-xs ml-1">(tú)</span>}
                </p>
                {p.telefono && <p className="text-gray-400 text-xs">{p.telefono}</p>}
              </div>
              <select
                value={p.rol}
                onChange={(e) => cambiarRol(p.id, e.target.value as Rol)}
                disabled={p.id === profile?.id}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>{r.etiqueta}</option>
                ))}
              </select>
              <button
                onClick={() => alternarActivo(p)}
                disabled={p.id === profile?.id}
                title={p.activo ? 'Quitar acceso' : 'Reactivar'}
                className={`text-xs px-2 py-1 rounded-full disabled:opacity-50 ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {p.activo ? 'Con acceso' : 'Sin acceso'}
              </button>
            </div>

            {p.rol === 'personal' && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-50">
                <span className="text-xs text-gray-400 self-center">Especialidades:</span>
                {ESPECIALIDADES.map((e) => {
                  const activa = (p.especialidades ?? []).includes(e.valor)
                  return (
                    <button
                      key={e.valor}
                      onClick={() => alternarEspecialidad(p, e.valor)}
                      className={`text-xs px-2 py-1 rounded-full border ${activa ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-400'}`}
                    >
                      {activa ? '✓ ' : ''}{e.etiqueta}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {visibles.length === 0 && <p className="text-sm text-gray-400 p-3">No hay usuarios que coincidan.</p>}
      </div>
    </div>
  )
}
