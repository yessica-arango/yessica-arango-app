import type { VercelRequest, VercelResponse } from '@vercel/node'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// Configuración VAPID — variables en Vercel (no en el repo).
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'contacto@yessicaarango.com'}`,
  process.env.VAPID_PUBLIC_KEY ?? '',
  process.env.VAPID_PRIVATE_KEY ?? ''
)

// Cliente con service_role para leer push_subscriptions (bypasa RLS).
const supabase = createClient(
  process.env.VITE_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { empleada_id, titulo, cuerpo, url } = req.body as {
    empleada_id: string
    titulo: string
    cuerpo: string
    url?: string
  }

  if (!empleada_id || !titulo || !cuerpo) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' })
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('user_id', empleada_id)

  if (error || !subs || subs.length === 0) {
    return res.status(200).json({ sent: 0, reason: 'Sin suscripción registrada.' })
  }

  const payload = JSON.stringify({
    title: titulo,
    body: cuerpo,
    data: { url: url ?? '/jornada' },
  })

  let sent = 0
  for (const row of subs) {
    try {
      await webpush.sendNotification(
        JSON.parse(row.subscription as string) as webpush.PushSubscription,
        payload
      )
      sent++
    } catch (e) {
      // Si la suscripción expiró (410 Gone), la eliminar para limpiar.
      const err = e as { statusCode?: number }
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('user_id', empleada_id)
      }
      console.error('[push] error al enviar:', e)
    }
  }

  return res.status(200).json({ sent })
}
