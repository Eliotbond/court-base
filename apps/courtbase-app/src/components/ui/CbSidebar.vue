<script setup lang="ts">
import { computed, ref, type FunctionalComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MoreVertical } from 'lucide-vue-next'

import CbUserMenu from './CbUserMenu.vue'
import { useClubStore } from '@/stores/club'

/**
 * S2 (partie sidebar) — Sidebar desktop ≥1024px. Logo + brand en haut, items
 * de nav (plats ou groupés par rôle), userchip en bas.
 *
 * **API `items`** :
 *  - `CbNavItem[]` — liste plate (rétro-compat, render comme un seul groupe
 *    sans titre).
 *  - `CbNavItemGroup[]` — groupes avec label uppercase rendus entre eux par
 *    un espacement vertical. Un group dont le `label` est vide est rendu
 *    sans header (utilisé pour l'item "Accueil" tout en haut, hors group
 *    par rôle).
 *
 * Branding : lit `useClubStore` (source de vérité, hydraté par `App.vue` au
 * démarrage). Les props `brandName` / `brandSub` / `clubInitials` ne sont
 * conservées que comme fallback.
 *
 * Le userchip est cliquable : ouvre un menu déroulant (Mon profil + Se
 * déconnecter) via `CbUserMenu`. Notifications + Profil restent dans ce
 * footer — ils ne sont pas dans les groups par rôle (cf. brief PR-M-A).
 *
 * Navigation : chaque item peut porter un `routeName` (+ `params` /
 * `activeRoutes`). Si présent, le click route directement via `router.push`
 * et l'item actif est auto-détecté depuis `route.name`. Le prop `active` et
 * l'event `select` restent en rétro-compat pour les cas custom.
 */
export interface CbNavItem {
  icon: FunctionalComponent
  label: string
  /** Nom de la route Vue Router. Si présent → click navigue + auto-active. */
  routeName?: string
  /** Params pour `router.push({ name: routeName, params })` si la route en exige. */
  params?: Record<string, string>
  /**
   * Routes additionnelles qui marquent cet item comme actif. Utile pour les
   * sous-pages (ex. `'member-edit'` peut activer "Mes équipes").
   */
  activeRoutes?: ReadonlyArray<string>
  badge?: number | null
  /** Legacy — non utilisé par le shell, conservé pour compat. */
  to?: string
}

/**
 * Groupe d'items de sidebar. `label` vide = pas de header rendu (utile pour
 * l'item Accueil top-level).
 */
export interface CbNavItemGroup {
  /** Label affiché en uppercase au-dessus des items. Vide = pas de header. */
  label: string
  items: CbNavItem[]
}

type CbNavInput = ReadonlyArray<CbNavItem> | ReadonlyArray<CbNavItemGroup>

const props = defineProps<{
  items: CbNavInput
  /**
   * Override manuel de l'index actif (legacy). Si non fourni, auto-détecté
   * depuis `route.name` matché contre `item.routeName` / `item.activeRoutes`.
   * **Note** : en mode groupé, l'index est calculé sur la liste APLATIE des
   * items (parcours linéaire group après group, dans l'ordre).
   */
  active?: number
  brandName?: string
  brandSub?: string
  clubInitials?: string
  userName?: string
  userRole?: string
  /**
   * Item Notifications affiché dans le footer de la sidebar (au-dessus du
   * userchip). Optionnel — si absent, le footer ne contient que le
   * userchip. Porte son propre `badge` (compteur non-lues) qui s'affiche
   * comme une pastille rose `.nav-badge` à droite du label.
   */
  notifItem?: CbNavItem
}>()

const emit = defineEmits<{ select: [index: number] }>()

const route = useRoute()
const router = useRouter()

/**
 * Normalise les `items` en `CbNavItemGroup[]`. Si entrée plate (`CbNavItem[]`),
 * wrap dans un unique group sans label. Discrimination : un `CbNavItemGroup`
 * a la clé `items` (array), un `CbNavItem` a la clé `icon` (function).
 */
const groups = computed<CbNavItemGroup[]>(() => {
  const arr = props.items
  if (arr.length === 0) return []
  const first = arr[0] as CbNavItem | CbNavItemGroup
  const isGrouped = first != null && 'items' in first && Array.isArray((first as CbNavItemGroup).items)
  if (isGrouped) {
    return arr as ReadonlyArray<CbNavItemGroup> as CbNavItemGroup[]
  }
  return [{ label: '', items: [...(arr as ReadonlyArray<CbNavItem>)] }]
})

/** Liste aplatie : utile pour `effectiveActive` (index global) + `onItemClick`. */
const flatItems = computed<CbNavItem[]>(() => groups.value.flatMap((g) => g.items))

/**
 * Index calculé sur `flatItems` : matche `route.name` (puis `activeRoutes`).
 * Retombe sur `props.active` si pas de match. -1 = pas d'item actif.
 */
const autoActiveIndex = computed<number>(() => {
  const name = typeof route.name === 'string' ? route.name : null
  if (!name) return -1
  const exact = flatItems.value.findIndex((it) => it.routeName === name)
  if (exact >= 0) return exact
  return flatItems.value.findIndex((it) => it.activeRoutes?.includes(name) ?? false)
})

const effectiveActive = computed<number>(() => {
  if (autoActiveIndex.value >= 0) return autoActiveIndex.value
  return props.active ?? -1
})

/**
 * Convertit un (groupIndex, itemIndexInGroup) en index global aplati pour le
 * matching `effectiveActive`.
 */
function globalIndex(groupIndex: number, itemIndex: number): number {
  let offset = 0
  for (let g = 0; g < groupIndex; g += 1) {
    offset += groups.value[g]?.items.length ?? 0
  }
  return offset + itemIndex
}

function onItemClick(globalIdx: number): void {
  const item = flatItems.value[globalIdx]
  if (!item) return
  if (item.routeName) {
    void router.push({ name: item.routeName, params: item.params })
    return
  }
  emit('select', globalIdx)
}

const clubStore = useClubStore()

/**
 * Résolution du branding : store en priorité dès qu'il est chargé, sinon
 * fallback sur les props passées par la vue. Les valeurs hardcodées des 24
 * vues ("BC Aigles" / "Saison 2025/26") sont ainsi écrasées sans avoir à
 * toucher chaque vue.
 */
const resolvedBrandName = computed(
  () => clubStore.name ?? props.brandName ?? 'Courtbase',
)
const resolvedBrandSub = computed(
  () => clubStore.seasonLabel ?? props.brandSub ?? '',
)
const resolvedClubInitials = computed(() =>
  clubStore.loaded ? clubStore.initials : (props.clubInitials ?? 'CB'),
)
const resolvedLogoUrl = computed(() => clubStore.logoUrl)

const userInitials = computed(() =>
  (props.userName ?? '')
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
)

const menuOpen = ref(false)

/**
 * Le footer Notifications est marqué actif quand on est sur la route
 * `notifications` (ou un alias listé dans `activeRoutes`). Match indépendant
 * de l'index global des groups — Notifications n'est PAS dans `flatItems`.
 */
const notifActive = computed<boolean>(() => {
  if (!props.notifItem) return false
  const name = typeof route.name === 'string' ? route.name : null
  if (!name) return false
  if (props.notifItem.routeName === name) return true
  return props.notifItem.activeRoutes?.includes(name) ?? false
})

function onNotifClick(): void {
  const item = props.notifItem
  if (!item || !item.routeName) return
  void router.push({ name: item.routeName, params: item.params })
}
</script>

<template>
  <aside class="cb-sidebar">
    <div class="brand">
      <div class="cb-logo">
        <img
          v-if="resolvedLogoUrl"
          :src="resolvedLogoUrl"
          :alt="`Logo ${resolvedBrandName}`"
          class="cb-logo-img"
        />
        <template v-else>{{ resolvedClubInitials }}</template>
      </div>
      <div>
        <div class="name">{{ resolvedBrandName }}</div>
        <div class="sub">{{ resolvedBrandSub }}</div>
      </div>
    </div>
    <div class="cb-nav-groups">
      <div
        v-for="(group, gi) in groups"
        :key="gi"
        class="cb-nav-group"
      >
        <div v-if="group.label" class="cb-nav-group-label">
          {{ group.label }}
        </div>
        <button
          v-for="(it, ii) in group.items"
          :key="`${gi}-${ii}`"
          type="button"
          class="cb-navitem"
          :class="{ active: effectiveActive === globalIndex(gi, ii) }"
          @click="onItemClick(globalIndex(gi, ii))"
        >
          <component
            :is="it.icon"
            :size="18"
            :stroke-width="effectiveActive === globalIndex(gi, ii) ? 2 : 1.7"
          />
          <span>{{ it.label }}</span>
          <span v-if="it.badge" class="nav-badge">{{ it.badge }}</span>
        </button>
      </div>
    </div>
    <div class="cb-sidebar-bottom" style="position: relative">
      <button
        v-if="notifItem"
        type="button"
        class="cb-navitem cb-navitem-footer"
        :class="{ active: notifActive }"
        @click="onNotifClick"
      >
        <component
          :is="notifItem.icon"
          :size="18"
          :stroke-width="notifActive ? 2 : 1.7"
        />
        <span>{{ notifItem.label }}</span>
        <span v-if="notifItem.badge" class="nav-badge">{{ notifItem.badge }}</span>
      </button>
      <button
        type="button"
        class="cb-userchip"
        style="width: 100%; border: 0; font-family: inherit; text-align: left"
        @click="menuOpen = !menuOpen"
      >
        <span class="cb-avatar sm">{{ userInitials || '?' }}</span>
        <div style="flex: 1; min-width: 0">
          <div class="name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ userName ?? '' }}
          </div>
          <div class="role">{{ userRole ?? '' }}</div>
        </div>
        <MoreVertical :size="16" />
      </button>
      <CbUserMenu v-model:visible="menuOpen" anchor="bottom-left" />
    </div>
  </aside>
</template>

<style scoped>
.cb-nav-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cb-nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cb-nav-group + .cb-nav-group {
  margin-top: 12px;
}
.cb-nav-group-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-subtle);
  padding: 8px 10px 4px;
}
/* Notifications dans le footer : même apparence que les cb-navitem des
   groups (hover/active emerald + nav-badge rose) mais largeur 100% du
   footer et marge basse pour le séparer du userchip. */
.cb-navitem-footer {
  width: 100%;
  margin-bottom: 8px;
}
</style>
