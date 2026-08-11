/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] }

// Sin esto, un service worker nuevo se queda "esperando" indefinidamente
// hasta que se cierren TODAS las pestañas/instancias abiertas de la app —
// en una PWA que la gente deja abierta en el celular, eso podía nunca pasar,
// dejando a alguien atascado en una versión vieja (con columnas/campos que
// ya no existen en la base de datos) sin ninguna señal de que pasó.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Muestra la notificación push cuando llega desde el servidor.
self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body, data } = event.data.json() as {
    title: string
    body: string
    data?: { url?: string }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data,
    })
  )
})

// Al tocar la notificación: enfoca la pestaña existente o abre una nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/jornada'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) {
            ;(client as WindowClient).focus()
            return
          }
        }
        return self.clients.openWindow(url)
      })
  )
})
