import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  countUnread as mockCountUnread,
  listNotifications as mockListNotifications,
  logMockAction,
  type MockNotification,
} from '@/repositories/mock'

/**
 * Store notifications (mode mock, refactor 2026-05-24).
 *
 * **But** : centraliser l'état (liste + nombre non lues) dans une source
 * réactive Pinia, pour que les badges du shell (sidebar + tab bar + bell
 * du header) restent en sync quand l'utilisateur ouvre une notif, ou quand
 * Firestore poussera des updates en temps réel (Phase 2).
 *
 * **Pourquoi ce store** : avant ce refactor, `useShellNav` lisait
 * `countUnread()` (fonction pure sur un tableau module-level statique). Le
 * `computed` Vue ne se ré-invalidait jamais — le badge restait figé. Avec
 * un `ref` Pinia, l'UI réagit aux mutations `markRead`/`markAllRead` et,
 * plus tard, aux snapshots Firestore.
 *
 * **Architecture en couches** : ce store est volontairement plat (pas de
 * repo dédié pour le moment) puisque la source actuelle est du mock pur.
 * Quand on branchera Firestore (`/notifications/{notifId}` per-user), on
 * extraira un `notifications.repo.ts` qui exposera
 * `subscribeMyNotifications(uid)` + `markRead(notifId)` (callable serveur
 * pour respecter les rules) — l'API publique du store reste inchangée.
 *
 * **5 dernières (preview)** : exposé via `recentForPreview` pour les popovers
 * de la sidebar / header. Trié par "fraîcheur" approximative (les unread en
 * premier puis ordre source). MVP suffit pour la prévisualisation — quand
 * Firestore arrive on triera par `createdAt` desc.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  // État interne — mutable copie du fixture mock pour permettre les
  // mutations local-only (markRead). Les `notif.unread` sont mis à jour en
  // place, le `unreadCount` est recalculé via computed sur `notifs.value`.
  const notifs = ref<MockNotification[]>(mockListNotifications().map((n) => ({ ...n })))

  const unreadCount = computed<number>(
    () => notifs.value.filter((n) => n.unread).length,
  )

  /** Aperçu pour popover : 5 plus récentes (unread first, puis le reste). */
  const recentForPreview = computed<ReadonlyArray<MockNotification>>(() => {
    const unread = notifs.value.filter((n) => n.unread)
    const read = notifs.value.filter((n) => !n.unread)
    return [...unread, ...read].slice(0, 5)
  })

  /**
   * Marque une notification comme lue (idempotent). Mock-only pour
   * l'instant — ne propage rien côté serveur. Quand Firestore sera branché :
   * appel callable `markNotificationRead({ notifId })` + maj optimiste.
   */
  function markRead(notifId: string): void {
    const target = notifs.value.find((n) => n.id === notifId)
    if (!target || !target.unread) return
    target.unread = false
    logMockAction('notifications.markRead', { notifId })
  }

  /** Marque toutes les notifs comme lues (utile au CTA "Tout marquer lu"). */
  function markAllRead(): void {
    let touched = 0
    for (const n of notifs.value) {
      if (n.unread) {
        n.unread = false
        touched += 1
      }
    }
    if (touched > 0) {
      logMockAction('notifications.markAllRead', { count: touched })
    }
  }

  /**
   * Rafraîchit la liste depuis le repo source. En mode mock = reset l'état
   * local sur le fixture (les markRead précédents sont perdus — voulu pour
   * démo). En mode Firestore : no-op (la souscription temps réel pousse).
   */
  function refresh(): void {
    notifs.value = mockListNotifications().map((n) => ({ ...n }))
    logMockAction('notifications.refresh')
  }

  return {
    notifs,
    unreadCount,
    recentForPreview,
    markRead,
    markAllRead,
    refresh,
  }
})

/**
 * Helper non-store : compatible avec l'ancienne API `countUnread()` du repo
 * mock. **Ne pas utiliser dans un composable / store** (perd la réactivité
 * Pinia) — préférer `useNotificationsStore().unreadCount`.
 */
export function legacyCountUnread(): number {
  return mockCountUnread()
}
