import { computed } from 'vue'
import {
  BellRing,
  CalendarCheck,
  CalendarDays,
  Clipboard,
  ClipboardList,
  FileCheck,
  Home as HomeIcon,
  Inbox,
  Megaphone,
  MoreHorizontal,
  Shield,
  User as UserIcon,
  Users,
} from 'lucide-vue-next'

import { listRequests } from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'
import { useLicenseRequestsStore } from '@/stores/licenseRequests'
import { useOfficialsStore } from '@/stores/officials'
import { useRegistrationsStore } from '@/stores/registrations'
import type { CbNavItem, CbNavItemGroup } from '@/components/ui/CbSidebar.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'
import type { AppRole } from '@/types/roles'

/**
 * Nav + tab bar role-aware (refactor PR-M-A 2026-05-24).
 *
 * **Nouvelle API (3 valeurs)** :
 *  - `tabs`   : `ComputedRef<CbTab[]>` — tab bar mobile, max 4 items dérivés
 *    des rôles ACTIFS du user (Home + 1 onglet par rôle, ordre Coach >
 *    Officiel > Admin > Joueur). Voir §"Sélection tabs mobile" du brief.
 *  - `nav`    : `ComputedRef<CbNavItemGroup[]>` — sidebar desktop groupée.
 *    Un group par rôle actif (label uppercase) + un group "home" en tête
 *    sans label (Accueil tout en haut, hors group). Voir §"Sidebar desktop —
 *    grouping" du brief.
 *  - `primaryRoleLabel` : `ComputedRef<string>` — label "Coach" / "Officiel"
 *    / "Admin" / "Joueur" pour l'avatar du shell. Priorité Coach > Admin >
 *    Officiel > Joueur (multi-role) ; "Visiteur" si aucun rôle.
 *
 * **Rétro-compat** : les collections legacy (`coachTabs`, `officialTabs`,
 * `adminTabs`, `playerTabs`, `multiRoleTabs`, `coachNav`, `officialNav`,
 * `adminNav`, `playerNav`, `navForRoles`, `tabsForRoles`) restent exportées
 * — les 23 vues qui les consomment continuent de fonctionner sans refactor.
 * À nettoyer en PR-M-D quand Home et les sections seront refondues.
 *
 * **Badges** : injectés via stores Pinia (`licenseRequestsStore`,
 * `officialsStore`) + repos mock (`countUnread`, `listRegistrationsToTreat`,
 * `listRequests`). Les `computed` propagent la réactivité aux tabs/nav.
 *
 * **`routeName` par item** : chaque item porte un `routeName`. Le shell
 * (CbSidebar / CbTabBar) route directement via `router.push({ name })` et
 * auto-détecte l'item actif depuis `useRoute().name`.
 */
export function useShellNav() {
  const authStore = useAuthStore()
  const licenseRequestsStore = useLicenseRequestsStore()
  const officialsStore = useOfficialsStore()
  const registrationsStore = useRegistrationsStore()

  /**
   * **Alpha 2026-05-25** : badge notifs neutralisé en attendant la Phase 5
   * (FCM web push). Conservé comme `ComputedRef<null>` pour ne pas casser
   * les call-sites (vues qui passent `:notif-badge="notifBadge ?? false"`
   * au shell — un badge falsy fait disparaître la cloche/pastille).
   * Quand on rebranchera les notifs, restaurer la lecture sur
   * `useNotificationsStore().unreadCount`.
   */
  const notifBadge = computed<number | null>(() => null)
  /**
   * Badge "Inscriptions" coach — uniquement les inscriptions **actionables**
   * (bucket `demande` + `essai`, cf. `bucketFor`). Source : store réel
   * `useRegistrationsStore.counts.actionable`. Avant : `listRegistrationsToTreat()`
   * mock comptait toutes les statuts pré-décision indépendamment du club →
   * affichait par ex. "4" alors que toutes étaient en bucket `confirmé`.
   * Le store est alimenté par `HomeCoachSection` et `coach/Registrations.vue` ;
   * sur les autres vues coach le badge sera à 0 tant que le store n'a pas
   * été chargé (acceptable — meilleur que faux positif).
   */
  const coachRegistrationsBadge = computed(
    () => registrationsStore.counts.actionable || null,
  )
  const adminRequestsBadge = computed(() => listRequests({ status: 'pending' }).length || null)
  /**
   * Matchs "à pourvoir" pour l'officiel — somme des matchs incomplets.
   * Source : `officialsStore.incompleteMatchesCount`. Reste à `null` (badge
   * caché) tant que le store n'a pas chargé.
   */
  const officialOpenMatchesBadge = computed(
    () => officialsStore.incompleteMatchesCount || null,
  )
  /**
   * Demandes de licence à valider par le coach. Lit `pendingReviewList` du
   * store — peuplé par `loadPendingReviewForCoach()`.
   */
  const coachLicenseReviewsBadge = computed(
    () => licenseRequestsStore.pendingReviewList.length || null,
  )

  // ─── Tab bars mobile legacy (rétro-compat) ──────────────────────

  const coachTabs = computed<CbTab[]>(() => [
    { icon: Users, label: 'Équipes', routeName: 'team', activeRoutes: ['team-roster', 'member', 'member-edit', 'member-new', 'planning', 'training-attendance', 'away-match-create'] },
    { icon: CalendarDays, label: 'Agenda', routeName: 'agenda' },
    { icon: Clipboard, label: 'Inscriptions', routeName: 'registrations', activeRoutes: ['registration-detail'], badge: coachRegistrationsBadge.value },
  ])

  const officialTabs = computed<CbTab[]>(() => [
    { icon: BellRing, label: 'À pourvoir', routeName: 'matches-open', activeRoutes: ['match-detail'], badge: officialOpenMatchesBadge.value },
    { icon: CalendarDays, label: 'Mes matchs', routeName: 'my-assignments' },
  ])

  const adminTabs = computed<CbTab[]>(() => [
    { icon: BellRing, label: 'Staffing', routeName: 'staffing', activeRoutes: ['staffing-detail'] },
    { icon: Inbox, label: 'Demandes', routeName: 'requests', activeRoutes: ['request-detail', 'license-requests'], badge: adminRequestsBadge.value },
    { icon: Megaphone, label: 'Diffuser', routeName: 'broadcast' },
  ])

  const playerTabs = computed<CbTab[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
    { icon: CalendarDays, label: 'Agenda', routeName: 'agenda' },
  ])

  /**
   * Tab bar legacy multi-rôle (rétro-compat — Home.vue actuel l'utilise).
   * Le nouveau `tabs` ci-dessous remplace progressivement cet usage.
   */
  const multiRoleTabs = computed<CbTab[]>(() => [
    { icon: HomeIcon, label: 'Coach' },
    { icon: BellRing, label: 'Officiel' },
    { icon: Shield, label: 'Admin' },
  ])

  /** Tab bar minimaliste (fallback générique). */
  const basicTabs = computed<CbTab[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
  ])

  // ─── Sidebars desktop legacy (rétro-compat) ─────────────────────

  const coachNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
    { icon: CalendarCheck, label: 'Mon calendrier', routeName: 'my-calendar' },
    { icon: Users, label: 'Mes équipes', routeName: 'team', activeRoutes: ['team-roster', 'member', 'member-edit', 'member-new', 'planning', 'training-attendance', 'away-match-create'] },
    { icon: CalendarDays, label: 'Agenda', routeName: 'agenda' },
    { icon: Clipboard, label: 'Inscriptions', routeName: 'registrations', activeRoutes: ['registration-detail'], badge: coachRegistrationsBadge.value },
    { icon: FileCheck, label: 'Licences', routeName: 'license-reviews', activeRoutes: ['license-request-review'], badge: coachLicenseReviewsBadge.value },
  ])

  const officialNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
    { icon: CalendarCheck, label: 'Mon calendrier', routeName: 'my-calendar' },
    { icon: BellRing, label: 'Matchs à pourvoir', routeName: 'matches-open', activeRoutes: ['match-detail'], badge: officialOpenMatchesBadge.value },
    { icon: CalendarDays, label: 'Calendrier des Officiels', routeName: 'my-assignments' },
  ])

  const adminNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
    { icon: CalendarCheck, label: 'Mon calendrier', routeName: 'my-calendar' },
    { icon: BellRing, label: 'Staffing', routeName: 'staffing', activeRoutes: ['staffing-detail'] },
    { icon: Inbox, label: 'Demandes', routeName: 'requests', activeRoutes: ['request-detail'], badge: adminRequestsBadge.value },
    { icon: FileCheck, label: 'Demandes licence', routeName: 'license-requests' },
    { icon: CalendarDays, label: 'Agenda', routeName: 'agenda' },
    { icon: Megaphone, label: 'Diffuser', routeName: 'broadcast' },
  ])

  const playerNav = computed<CbNavItem[]>(() => [
    { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
    { icon: CalendarCheck, label: 'Mon calendrier', routeName: 'my-calendar' },
    { icon: UserIcon, label: 'Mon profil', routeName: 'profile-settings' },
  ])

  // ─── Sélecteurs par rôles legacy (rétro-compat) ─────────────────

  function navForRoles(roles: ReadonlyArray<AppRole>): CbNavItem[] {
    if (roles.includes('coach')) return coachNav.value
    if (roles.includes('official')) return officialNav.value
    if (roles.includes('admin')) return adminNav.value
    if (roles.includes('player')) return playerNav.value
    return []
  }

  function tabsForRoles(roles: ReadonlyArray<AppRole>): CbTab[] {
    if (roles.length > 1) return multiRoleTabs.value
    if (roles.includes('coach')) return coachTabs.value
    if (roles.includes('official')) return officialTabs.value
    if (roles.includes('admin')) return adminTabs.value
    if (roles.includes('player')) return playerTabs.value
    return basicTabs.value
  }

  // ─── Nouvelle API (PR-M-A) ──────────────────────────────────────

  /**
   * Rôles actifs du user, dans l'ordre canonique Coach > Officiel > Joueur.
   *
   * **Alpha 2026-05-25** : la branche `admin` a été retirée — la partie
   * admin de l'app (broadcast, staffing, demandes) est désactivée le temps
   * que les workflows soient finalisés. Le flag `authStore.isAdmin` reste
   * disponible pour d'autres usages (gates Firestore Rules côté UI, badges),
   * mais ne contribue plus aux tabs/nav du shell.
   */
  const activeRoles = computed<AppRole[]>(() => {
    // Lit les flags **inclusifs** `is*` du store auth (rôle déclaré OU
    // licence active confirmée) plutôt que `roles` brut — cohérent avec la
    // sémantique du badge "Officiel actif" / "Coach actif" côté admin. Un
    // user avec licence Officiel confirmée voit la section/tab Officiel
    // même si son `/users.roles` ne porte pas encore le claim 'official'.
    const ordered: AppRole[] = []
    if (authStore.isCoach) ordered.push('coach')
    if (authStore.isOfficial) ordered.push('official')
    // 'player' n'a pas de flag inclusif (pas de notion de "joueur actif via
    // licence" distincte de l'appartenance à une équipe) — lecture directe.
    if (authStore.roles.includes('player')) ordered.push('player')
    return ordered
  })

  /**
   * Item de tab mobile le plus représentatif pour chaque rôle. Conforme au
   * brief §"Sélection tabs mobile" (Coach → Équipes, Officiel → Assignations,
   * Admin → Staffing, Joueur → Agenda).
   */
  function tabForRole(role: AppRole): CbTab {
    switch (role) {
      case 'coach':
        return {
          icon: Users,
          label: 'Équipes',
          routeName: 'team',
          activeRoutes: ['team-roster', 'member', 'member-edit', 'member-new', 'planning', 'training-attendance', 'away-match-create'],
        }
      case 'official':
        return {
          icon: ClipboardList,
          // Label court "Calendrier" pour la tab bar mobile (espace limité —
          // "Calendrier des Officiels" est trop long). Cohérent avec le
          // titre desktop long "Calendrier des Officiels" porté par les vues
          // (cf. MyAssignments.vue / officialNav legacy).
          label: 'Calendrier',
          routeName: 'my-assignments',
          activeRoutes: ['match-detail', 'matches-open'],
        }
      case 'admin':
        return {
          icon: Shield,
          label: 'Staffing',
          routeName: 'staffing',
          activeRoutes: ['staffing-detail'],
        }
      case 'player':
        // Le joueur arrive directement sur "Mon calendrier" (plus pertinent
        // que l'agenda club-wide qui ne lui est pas destiné).
        return {
          icon: CalendarCheck,
          label: 'Mon calendrier',
          routeName: 'my-calendar',
        }
    }
  }

  /**
   * Tab bar mobile (max 4 items). Slot 1 = Home. Slots 2-4 = 1 item par rôle
   * actif (Coach > Officiel > Joueur).
   *
   * **Cas > 3 rôles actifs** : avec admin désactivé en alpha (2026-05-25)
   * le cas est techniquement injoignable (max 3 rôles actifs : coach,
   * official, player). On garde la branche `MoreHorizontal` comme garde-fou
   * en cas d'ajout futur d'un 4e rôle, mais elle pointe maintenant vers
   * `home` (la route `notifications` n'est plus dans l'allowlist).
   */
  const tabs = computed<CbTab[]>(() => {
    const home: CbTab = { icon: HomeIcon, label: 'Accueil', routeName: 'home' }
    const roleTabs = activeRoles.value.map(tabForRole)
    if (roleTabs.length <= 3) {
      return [home, ...roleTabs]
    }
    // > 3 rôles → garder les 2 premiers + un slot "Plus" inerte.
    const morePlaceholder: CbTab = {
      icon: MoreHorizontal,
      label: 'Plus',
      routeName: 'home',
    }
    return [home, roleTabs[0]!, roleTabs[1]!, morePlaceholder]
  })

  /**
   * Items de sidebar pour un rôle donné. Sources : extraites des listes
   * legacy (`coachNav`, `officialNav`, etc.) en retirant les items neutres
   * (Accueil, Notifications, Mon profil) qui restent hors des groups par
   * rôle (Accueil = group "home" en tête, Notifs + Profil = footer sidebar).
   */
  function navItemsForRole(role: AppRole): CbNavItem[] {
    switch (role) {
      case 'coach':
        return [
          { icon: Users, label: 'Mes équipes', routeName: 'team', activeRoutes: ['team-roster', 'member', 'member-edit', 'member-new', 'planning', 'training-attendance', 'away-match-create'] },
          { icon: CalendarDays, label: 'Agenda club', routeName: 'agenda' },
          { icon: Clipboard, label: 'Inscriptions', routeName: 'registrations', activeRoutes: ['registration-detail'], badge: coachRegistrationsBadge.value },
          { icon: FileCheck, label: 'Licences', routeName: 'license-reviews', activeRoutes: ['license-request-review'], badge: coachLicenseReviewsBadge.value },
        ]
      case 'official':
        return [
          { icon: BellRing, label: 'Matchs à pourvoir', routeName: 'matches-open', activeRoutes: ['match-detail'], badge: officialOpenMatchesBadge.value },
          { icon: CalendarDays, label: 'Calendrier des Officiels', routeName: 'my-assignments' },
        ]
      case 'admin':
        return [
          { icon: BellRing, label: 'Staffing', routeName: 'staffing', activeRoutes: ['staffing-detail'] },
          { icon: Inbox, label: 'Demandes', routeName: 'requests', activeRoutes: ['request-detail'], badge: adminRequestsBadge.value },
          { icon: FileCheck, label: 'Demandes licence', routeName: 'license-requests' },
          { icon: CalendarDays, label: 'Agenda club', routeName: 'agenda' },
          { icon: Megaphone, label: 'Diffuser', routeName: 'broadcast' },
        ]
      case 'player':
        // Pour le joueur, le nav "rôle" est minimal — Mon calendrier est
        // déjà exposé en tête de la sidebar (group "home").
        return []
    }
  }

  /** Label uppercase pour le group label de chaque rôle. */
  function groupLabelForRole(role: AppRole): string {
    switch (role) {
      case 'coach':
        return 'COACH'
      case 'official':
        return 'OFFICIEL'
      case 'admin':
        return 'ADMIN'
      case 'player':
        return 'JOUEUR'
    }
  }

  /**
   * Sidebar desktop groupée. Premier group = "home" (label vide) avec
   * uniquement Accueil — il est rendu **sans label header** par CbSidebar
   * (cf. logique render `if (group.label) { ... }`). Choix d'archi : un
   * seul render path (toujours `CbNavItemGroup[]`) plutôt qu'un item home
   * "top-level" séparé qui aurait imposé un cas spécial dans le shell.
   *
   * Groups suivants : un par rôle actif (Coach > Officiel > Admin > Joueur)
   * avec son label uppercase. L'item **Notifications** est lui exposé
   * séparément via `notifItem` et rendu dans le footer de la sidebar
   * (au-dessus du userchip) — pour qu'il reste visible quel que soit le
   * scroll des groups et conserver un emplacement persistant pour le
   * badge non-lues.
   */
  const nav = computed<CbNavItemGroup[]>(() => {
    // Group "home" — Accueil + Mon calendrier (visibles pour tous les rôles
    // sans label, en tête de sidebar). Mon calendrier est la vue personnelle
    // multi-rôle (entraînements/matchs des équipes du caller + assignations
    // officiel) ; elle complète l'Agenda club-wide réservé aux coachs/admin.
    const groups: CbNavItemGroup[] = [
      {
        label: '',
        items: [
          { icon: HomeIcon, label: 'Accueil', routeName: 'home' },
          { icon: CalendarCheck, label: 'Mon calendrier', routeName: 'my-calendar' },
        ],
      },
    ]
    for (const role of activeRoles.value) {
      const items = navItemsForRole(role)
      if (items.length > 0) {
        groups.push({ label: groupLabelForRole(role), items })
      }
    }
    return groups
  })

  /**
   * **Alpha 2026-05-25** : item Notifications désactivé en attendant la
   * Phase 5 (FCM web push). On retourne `undefined` ; `CbDesktopShell` /
   * `CbSidebar` rendent l'item conditionnellement (`v-if="notifItem"`),
   * donc l'entrée disparaît proprement du footer sidebar. Le type reste
   * compatible avec les call-sites qui passent au shell sans destructurer.
   */
  const notifItem = computed<CbNavItem | undefined>(() => undefined)

  /**
   * Label de rôle principal pour l'avatar du shell. Priorité dédiée
   * (Coach > Admin > Officiel > Joueur) — diffère de l'ordre d'affichage
   * des sections (qui place Officiel avant Admin). Choix produit : Admin
   * "pèse plus" identitairement, c'est le label qu'on affiche en chip
   * profil. "Visiteur" si aucun rôle.
   */
  const primaryRoleLabel = computed<string>(() => {
    const r = authStore.roles
    if (r.includes('coach')) return 'Coach'
    if (r.includes('admin')) return 'Admin'
    if (r.includes('official')) return 'Officiel'
    if (r.includes('player')) return 'Joueur'
    return 'Visiteur'
  })

  return {
    // ─── Nouvelle API (PR-M-A) ──
    tabs,
    nav,
    notifItem,
    primaryRoleLabel,
    // ─── Badges (exposés pour les vues qui les composent) ──
    notifBadge,
    coachRegistrationsBadge,
    adminRequestsBadge,
    // ─── Legacy collections (rétro-compat — 23 vues consommatrices) ──
    coachTabs,
    officialTabs,
    adminTabs,
    playerTabs,
    multiRoleTabs,
    basicTabs,
    coachNav,
    officialNav,
    adminNav,
    playerNav,
    navForRoles,
    tabsForRoles,
  }
}
