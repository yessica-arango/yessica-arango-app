import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
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

  async function cargar() {
    const { data } = await supabase.from('profiles').select('*').order('nombre')
    setPerfiles((data as Profile[]) ?? [])
  }

  useEffect(() => {
    cargar()
  }, [])

  async function cambiarRol(id: string, rol: Rol) {
    await supabase.from('profiles').update({ rol }).eq('id', id)
    cargar()
  }

  async function alternarActivo(p: Profile) {
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

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!f) return perfiles
    return perfiles.filter((p) => p.nombre.toLowerCase().includes(f) || p.rol.includes(f))
  }, [perfiles, filtro])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Usuarios</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800 space-y-1">
        <p>
          Cada persona <strong>crea su propia cuenta</strong> (las clientas desde “Crea tu cuenta”, y al
          personal lo das de alta en <strong>Supabase → Authentication → Add user</strong>). Aquí solo le
          cambias el <strong>rol</strong>, sus <strong>especialidades</strong> y si está activa.
        </p>
        <p>
          Las especialidades son solo una etiqueta: <strong>a cualquier profesional se le puede asignar
          cualquier servicio</strong>, sin importar cómo esté etiquetada.
        </p>
      </div>

      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por nombre o rol…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="space-y-3">
        {visibles.map((p) => (
          <div key={p.id} className="bg-white rounded-2xl shadow p-3 space-y-3">
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
                className={`text-xs px-2 py-1 rounded-full disabled:opacity-50 ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {p.activo ? 'Activa' : 'Inactiva'}
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
