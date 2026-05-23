<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Bell,
  BellRing,
  Calendar,
  Clipboard,
  Home as HomeIcon,
  Inbox,
  Megaphone,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-vue-next'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbNotifItem from '@/components/ui/CbNotifItem.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  listNotifications,
  logMockAction,
  type MockNotification,
} from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * C4 — Liste des notifications (vue commune à tous les rôles).
 *
 * But : voir l'historique des notifs reçues, marquer lues (mock), ouvrir le
 * deep-link de chaque notif. Filtres chips horizontaux scrollables au-dessus
 * de la liste.
 *
 * Mobile : `CbMobileShell` + tab bar role-aware (le user mock multi-rôle voit
 * une tab bar de 4 cases dont "Notifs" est active). Desktop ≥1024px :
 * `CbDesktopShell` + `CbPageHead` + filtres dans `actions` + liste centrée
 * max-width 720px.
 *
 * Pull-to-refresh natif non implémenté (pas de geste tactile dans cette PR).
 * À la place, un bouton "Rafraîchir" en haut de la liste log l'action mock.
 */
const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()

// ─── Filtres ─────────────────────────────────────────────────────
type FilterKind = 'all' | 'unread' | 'match' | 'requests' | 'urgent'

interface FilterDef {
  id: FilterKind
  label: string
  /** Si défini, affiche un compteur (ex. "Non lues · 2"). */
  countSource?: (notifs: ReadonlyArray<MockNotification>) => number
}

const filters: ReadonlyArray<FilterDef> = [
  { id: 'all', label: 'Toutes' },
  {
    id: 'unread',
    label: 'Non lues',
    countSource: (ns) => ns.filter((n) => n.unread).length,
  },
  { id: 'match', label: 'Matchs' },
  { id: 'requests', label: 'Demandes' },
  { id: 'urgent', label: 'Urgentes' },
]

const activeFilter = ref<FilterKind>('all')

function setFilter(id: FilterKind): void {
  if (activeFilter.value === id) return
  activeFilter.value = id
  logMockAction('c4.filter-changed', { filter: id })
}

// ─── Données + filtrage ─────────────────────────────────────────
const allNotifs = ref<ReadonlyArray<MockNotification>>(listNotifications())

function matchesFilter(n: MockNotification, kind: FilterKind): boolean {
  switch (kind) {
    case 'unread':
      return n.unread
    case 'match':
      return n.type === 'match'
    case 'requests':
      // "Demandes" = type `info` ou title qui mentionne une inscription/demande.
      return (
        n.type === 'info' ||
        /inscription|demande/i.test(n.title)
      )
    case 'urgent':
      return n.type === 'urgent'
    default:
      return true
  }
}

const filteredNotifs = computed<ReadonlyArray<MockNotification>>(() =>
  allNotifs.value.filter((n) => matchesFilter(n, activeFilter.value)),
)

const unreadCount = computed(() => countUnread())

function filterLabel(f: FilterDef): string {
  if (!f.countSource) return f.label
  const n = f.countSource(allNotifs.value)
  return n > 0 ? `${f.label} · ${n}` : f.label
}

// ─── Refresh (mock) ─────────────────────────────────────────────
function onRefresh(): void {
  logMockAction('c4.refresh')
  // Pas de mutation : les mocks sont read-only. On rafraîchit juste la ref
  // pour montrer qu'on relit la source — utile quand le repo passera async.
  allNotifs.value = listNotifications()
}

// ─── Tap notif → deep-link ──────────────────────────────────────
function onNotifClick(n: MockNotification): void {
  logMockAction('c4.mark-read', { notifId: n.id })
  if (!n.deepLink) return
  router.push({ name: n.deepLink.name, params: n.deepLink.params ?? {} }).catch((err) => {
    // Si la route cible n'existe pas (vues pas encore implémentées), on log
    // sans casser l'app — c'est le cas tant qu'on est en phase de wiring.
    console.warn('[c4.deep-link] navigation failed', err)
  })
}

// ─── Shell — tabs role-aware + sidebar nav ──────────────────────
const tabs = computed<CbTab[]>(() => {
  const items: CbTab[] = []
  if (auth.isCoach) items.push({ icon: Users, label: 'Coach' })
  if (auth.isOfficial) items.push({ icon: BellRing, label: 'Officiel' })
  if (auth.isAdmin) items.push({ icon: Megaphone, label: 'Admin' })
  items.push({
    icon: Bell,
    label: 'Notifs',
    badge: unreadCount.value > 0 ? unreadCount.value : undefined,
  })
  return items
})

const activeTabIndex = computed(() => tabs.value.length - 1)

const nav = computed<CbNavItem[]>(() => {
  const items: CbNavItem[] = [{ icon: HomeIcon, label: 'Accueil' }]
  if (auth.isCoach) {
    items.push({ icon: Users, label: 'Mes équipes' })
    items.push({ icon: Calendar, label: 'Planning' })
    items.push({ icon: Clipboard, label: 'Inscriptions' })
  }
  if (auth.isOfficial) {
    items.push({ icon: BellRing, label: 'Matchs à pourvoir' })
  }
  if (auth.isAdmin) {
    items.push({ icon: Shield, label: 'Demandes' })
  }
  items.push({
    icon: Bell,
    label: 'Notifications',
    badge: unreadCount.value > 0 ? unreadCount.value : undefined,
  })
  return items
})

const activeNavIndex = computed(() => nav.value.length - 1)

function onTabSelect(index: number): void {
  // Mapping inverse : on retrouve l'item via son label.
  const item = tabs.value[index]
  if (!item || index === activeTabIndex.value) return
  switch (item.label) {
    case 'Coach':
      router.push({ name: 'team' })
      break
    case 'Officiel':
      router.push({ name: 'matches-open' })
      break
    case 'Admin':
      router.push({ name: 'requests' })
      break
  }
}

function onNavSelect(index: number): void {
  const item = nav.value[index]
  if (!item || index === activeNavIndex.value) return
  switch (item.label) {
    case 'Accueil':
      router.push({ name: 'home' })
      break
    case 'Mes équipes':
      router.push({ name: 'team' })
      break
    case 'Matchs à pourvoir':
      router.push({ name: 'matches-open' })
      break
    case 'Demandes':
      router.push({ name: 'requests' })
      break
    case 'Inscriptions':
      router.push({ name: 'registrations' })
      break
  }
}

function onBack(): void {
  router.push({ name: 'home' })
}
</script>

<template>
  <!-- ─── Desktop shell (≥1024px) ──────────────────────────────── -->
  <CbDesktopShell
    v-if="isDesktop"
    :items="nav"
    :active="activeNavIndex"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="auth.isAdmin ? 'Admin' : auth.isCoach ? 'Coach' : 'Officiel'"
    @nav-select="onNavSelect"
  >
    <CbPageHead
      title="Notifications"
      :subtitle="
        unreadCount > 0
          ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}`
          : 'Tout est lu pour le moment.'
      "
    >
      <template #actions>
        <div class="cb-chiprow notif-chiprow">
          <button
            v-for="f in filters"
            :key="f.id"
            class="cb-chip"
            :class="{ active: activeFilter === f.id }"
            type="button"
            @click="setFilter(f.id)"
          >
            {{ filterLabel(f) }}
          </button>
        </div>
        <button type="button" class="cb-btn outline sm" @click="onRefresh">
          <RefreshCw :size="14" /> Rafraîchir
        </button>
      </template>
    </CbPageHead>

    <div class="notif-desktop-wrap">
      <div v-if="filteredNotifs.length === 0" class="notif-empty">
        <CbEmptyState
          :icon="Bell"
          title="Pas de notification pour le moment"
          body="Tout est à jour. Les nouvelles notifications apparaîtront ici dès leur réception."
        />
      </div>

      <div v-else class="cb-card flush notif-list">
        <div
          v-for="n in filteredNotifs"
          :key="n.id"
          class="notif-clickable"
          role="button"
          tabindex="0"
          @click="onNotifClick(n)"
          @keydown.enter.prevent="onNotifClick(n)"
          @keydown.space.prevent="onNotifClick(n)"
        >
          <CbNotifItem
            :type="n.type"
            :title="n.title"
            :extract="n.extract"
            :time="n.time"
            :unread="n.unread"
          />
        </div>
      </div>
    </div>
  </CbDesktopShell>

  <!-- ─── Mobile shell (< 1024px) ──────────────────────────────── -->
  <CbMobileShell
    v-else
    title="Notifications"
    show-back
    :notif-badge="unreadCount > 0"
    :tabs="tabs"
    :active-tab="activeTabIndex"
    @back="onBack"
    @tab-select="onTabSelect"
  >
    <div class="cb-chiprow">
      <button
        v-for="f in filters"
        :key="f.id"
        class="cb-chip"
        :class="{ active: activeFilter === f.id }"
        type="button"
        @click="setFilter(f.id)"
      >
        {{ filterLabel(f) }}
      </button>
    </div>

    <div class="notif-refresh-row">
      <button type="button" class="cb-btn ghost sm" @click="onRefresh">
        <RefreshCw :size="14" /> Rafraîchir
      </button>
    </div>

    <div v-if="filteredNotifs.length === 0" class="notif-empty">
      <CbEmptyState
        :icon="Bell"
        title="Pas de notification pour le moment"
        body="Tout est à jour. Les nouvelles notifications apparaîtront ici dès leur réception."
      />
    </div>

    <div v-else class="notif-list-mobile cb-card flush">
      <div
        v-for="n in filteredNotifs"
        :key="n.id"
        class="notif-clickable"
        role="button"
        tabindex="0"
        @click="onNotifClick(n)"
        @keydown.enter.prevent="onNotifClick(n)"
        @keydown.space.prevent="onNotifClick(n)"
      >
        <CbNotifItem
          :type="n.type"
          :title="n.title"
          :extract="n.extract"
          :time="n.time"
          :unread="n.unread"
        />
      </div>
    </div>
  </CbMobileShell>
</template>

<style scoped>
/* Wrapper cliquable autour de CbNotifItem (le composant ne déclare pas
   d'event natif). Hover discret pour signaler le tap area. */
.notif-clickable {
  cursor: pointer;
  outline: none;
}
.notif-clickable:hover :deep(.cb-notif) {
  background: var(--slate-50);
}
.notif-clickable:hover :deep(.cb-notif.unread) {
  background: var(--sky-100);
}
.notif-clickable:focus-visible :deep(.cb-notif) {
  box-shadow: inset 0 0 0 2px var(--emerald-600);
}

/* Mobile : barre "Rafraîchir" légère sous les chips. */
.notif-refresh-row {
  display: flex;
  justify-content: flex-end;
  padding: 8px 16px 0;
}

/* Empty state : padding aéré + icône centrée. */
.notif-empty {
  padding: 32px 16px;
}

/* Mobile : la liste reste flush pour que chaque notif occupe la pleine
   largeur du body slate-50. */
.notif-list-mobile {
  margin: 12px 16px 24px;
}

/* Desktop : conteneur centré avec largeur max 720px (conforme au brief). */
.notif-desktop-wrap {
  padding: 24px 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

/* Desktop : chiprow inline dans le slot actions du PageHead — pas de
   bordure ni de fond (déjà géré par le header). */
.notif-chiprow {
  border-bottom: 0;
  background: transparent;
  padding: 0;
  /* Sur très grand écran, autoriser le wrap si les chips débordent. */
  flex-wrap: wrap;
}
</style>
