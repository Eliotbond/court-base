import { computed } from 'vue'
import {
  Bell,
  BellRing,
  Calendar,
  Clipboard,
  Home as HomeIcon,
  Inbox,
  Megaphone,
  Shield,
  Users,
} from 'lucide-vue-next'

import { countUnread, listRegistrationsToTreat, listRequests } from '@/repositories/mock'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'

/**
 * Nav + tab bar role-aware.
 *
 * **Objet de ce composable** : éviter que chaque vue ré-inline son tableau
 * `tabsCoach: CbTab[]` et son `navCoach: CbNavItem[]` (problème identifié
 * sur la livraison initiale — 24 vues ont chacune leur duplicat). Tous les
 * écrans qui ont besoin d'un shell role-aware passent par ici.
 *
 * **Source des badges** : compte dynamique via mock repos (`countUnread`,
 * `listRegistrationsToTreat`, `listRequests`). À remplacer par des vrais
 * computeds depuis Pinia quand Firebase sera branché.
 *
 * **Usage typique** :
 * ```ts
 * const { coachTabs, coachNav, officialTabs, adminTabs, ... } = useShellNav()
 * ```
 *
 * Les tabs/nav sont des `computed` — réactifs aux changements de badges
 * (ex: une notif marquée lue décrémente le compteur).
 */
export function useShellNav() {
  const notifBadge = computed(() => countUnread() || null)
  const coachRegistrationsBadge = computed(() => listRegistrationsToTreat().length || null)
  const adminRequestsBadge = computed(() => listRequests({ status: 'pending' }).length || null)

  // ─── Tab bars mobile (4 cols max) ───────────────────────────────

  const coachTabs = computed<CbTab[]>(() => [
    { icon: Users, label: 'Équipes' },
    { icon: Calendar, label: 'Planning' },
    { icon: Clipboard, label: 'Inscriptions', badge: coachRegistrationsBadge.value },
    { icon: Bell, label: 'Notifs', badge: notifBadge.value },
  ])

  const officialTabs = computed<CbTab[]>(() => [
    { icon: BellRing, label: 'À pourvoir' },
    { icon: Calendar, label: 'Mes matchs' },
    { icon: Bell, label: 'Notifs', badge: notifBadge.value },
  ])

  const adminTabs = computed<CbTab[]>(() => [
    { icon: BellRing, label: 'Staffing' },
    { icon: Inbox, label: 'Demandes', badge: adminRequestsBadge.value },
    { icon: Megaphone, label: 'Diffuser' },
    { icon: Bell, label: 'Notifs', badge: notifBadge.value },
  ])

  /** Tab bar pour user multi-rôle : 1 onglet par rôle (Coach/Officiel/Admin) + Notifs. */
  const multiRoleTabs = computed<CbTab[]>(() => [
    { icon: HomeIcon, label: 'Coach' },
    { icon: BellRing, label: 'Officiel' },
    { icon: Shield, label: 'Admin' },
    { icon: Bell, label: 'Notifs', badge: notifBadge.value },
  ])

  /** Tab bar minimaliste (rôle unique sans tab spécifique). */
  const basicTabs = computed<CbTab[]>(() => [
    { icon: HomeIcon, label: 'Accueil' },
    { icon: Bell, label: 'Notifs', badge: notifBadge.value },
  ])

  // ─── Sidebars desktop ───────────────────────────────────────────

  const coachNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil' },
    { icon: Users, label: 'Mes équipes' },
    { icon: Calendar, label: 'Planning' },
    { icon: Clipboard, label: 'Inscriptions', badge: coachRegistrationsBadge.value },
    { icon: Bell, label: 'Notifications', badge: notifBadge.value },
  ])

  const officialNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil' },
    { icon: BellRing, label: 'Matchs à pourvoir' },
    { icon: Calendar, label: 'Mes assignations' },
    { icon: Bell, label: 'Notifications', badge: notifBadge.value },
  ])

  const adminNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil' },
    { icon: BellRing, label: 'Staffing' },
    { icon: Inbox, label: 'Demandes', badge: adminRequestsBadge.value },
    { icon: Megaphone, label: 'Diffuser' },
    { icon: Bell, label: 'Notifications', badge: notifBadge.value },
  ])

  return {
    notifBadge,
    coachRegistrationsBadge,
    adminRequestsBadge,
    coachTabs,
    officialTabs,
    adminTabs,
    multiRoleTabs,
    basicTabs,
    coachNav,
    officialNav,
    adminNav,
  }
}
