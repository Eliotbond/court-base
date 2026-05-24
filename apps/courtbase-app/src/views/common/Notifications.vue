<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, RefreshCw } from 'lucide-vue-next'

import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbNotifItem from '@/components/ui/CbNotifItem.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { logMockAction, type MockNotification } from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'

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
const notifications = useNotificationsStore()
const { isDesktop } = useViewport()
const { tabs, nav, notifItem, notifBadge, primaryRoleLabel } = useShellNav()

function goToNotifications(): void {
  void router.push({ name: 'notifications' })
}

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
/**
 * Source : `useNotificationsStore.notifs` (réactif). `computed` plutôt que
 * `ref` pour propager les markRead/markAllRead du store dans la liste sans
 * avoir à resynchroniser manuellement.
 */
const allNotifs = computed<ReadonlyArray<MockNotification>>(() => notifications.notifs)

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

const unreadCount = computed(() => notifications.unreadCount)

function filterLabel(f: FilterDef): string {
  if (!f.countSource) return f.label
  const n = f.countSource(allNotifs.value)
  return n > 0 ? `${f.label} · ${n}` : f.label
}

// ─── Refresh (mock) ─────────────────────────────────────────────
function onRefresh(): void {
  notifications.refresh()
}

// ─── Tap notif → deep-link (+ markRead) ─────────────────────────
function onNotifClick(n: MockNotification): void {
  notifications.markRead(n.id)
  logMockAction('c4.mark-read', { notifId: n.id })
  if (!n.deepLink) return
  router.push({ name: n.deepLink.name, params: n.deepLink.params ?? {} }).catch((err) => {
    // Si la route cible n'existe pas (vues pas encore implémentées), on log
    // sans casser l'app — c'est le cas tant qu'on est en phase de wiring.
    console.warn('[c4.deep-link] navigation failed', err)
  })
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
    :notif-item="notifItem"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    :user-role="primaryRoleLabel"
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
    :notif-badge="notifBadge ?? false"
    :tabs="tabs"
    @back="onBack"
    @notif-click="goToNotifications"
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
