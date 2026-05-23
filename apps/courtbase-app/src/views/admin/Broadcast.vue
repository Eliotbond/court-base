<script setup lang="ts">
/**
 * A4 — Broadcast notification (admin restreint).
 *
 * Formulaire pour envoyer une notification manuelle à une audience donnée.
 * Côté backend (à brancher plus tard) : `addDoc /notifications` puis le
 * trigger `fanoutNotification` produit les push FCM.
 *
 * Audiences supportées :
 * - `officials`         — tous les officiels (mock : 12 destinataires).
 * - `officials_level`   — officiels d'un niveau (1/2/3). Mock : niveau 1 = 4,
 *                         niveau 2 = 5, niveau 3 = 3.
 * - `team`              — membres d'une équipe (count = `team.playerIds.length`).
 * - `custom`            — multi-sélection de membres parmi un pool mock (issu
 *                         de `MOCK_MEMBERS`).
 *
 * UX :
 * - Form (type, audience, titre, message, deep-link) avec validation.
 * - Bouton "Aperçu" → toggle un `CbNotifItem` qui reflète le contenu saisi.
 * - Bouton "Envoyer" → modale de confirmation "Confirmer l'envoi à {N}
 *   destinataires" avant submit définitif.
 * - À la confirmation : `logMockAction('a4.broadcast', { … })` + `router.back()`.
 *
 * Mock-only — aucune mutation Firestore, aucun toast (pas de service global).
 *
 * Cf. `docs/design-brief-courtbase-app.md` § A4 + référence visuelle
 * `/tmp/courtbase-app-design/courtbase-app/project/screens/admin.jsx` (A4Mobile).
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  Bell,
  BellRing,
  Eye,
  Home as HomeIcon,
  Inbox,
  Megaphone,
  Send,
  Users,
  X,
} from 'lucide-vue-next'

import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbNotifItem from '@/components/ui/CbNotifItem.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import type { CbNavItem } from '@/components/ui/CbSidebar.vue'
import type { CbTab } from '@/components/ui/CbTabBar.vue'
import { useViewport } from '@/composables/useViewport'
import {
  countUnread,
  listTeams,
  logMockAction,
  type MockMember,
  type MockTeam,
} from '@/repositories/mock'
import { MOCK_MEMBERS } from '@/repositories/mock/seeds'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Types de notification supportés par `CbNotifItem` + backend. */
type BroadcastType = 'urgent' | 'officials_needed' | 'match_reminder' | 'new_match' | 'info'

/** Mapping `BroadcastType` → type accepté par `CbNotifItem`. Les libellés
 *  brief utilisent `match_reminder`/`new_match` mais l'item de notif n'a que
 *  les variantes `match` / `bell` / `info` — on harmonise ici. */
const TYPE_TO_NOTIF_ICON: Record<BroadcastType, 'urgent' | 'officials_needed' | 'match' | 'bell' | 'info'> = {
  urgent: 'urgent',
  officials_needed: 'officials_needed',
  match_reminder: 'match',
  new_match: 'match',
  info: 'info',
}

const TYPE_OPTIONS: ReadonlyArray<{ value: BroadcastType; label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'officials_needed', label: 'Officiels recherchés' },
  { value: 'match_reminder', label: 'Rappel match' },
  { value: 'new_match', label: 'Nouveau match' },
  { value: 'info', label: 'Info générale' },
]

type AudienceKind = 'officials' | 'officials_level' | 'team' | 'custom'

interface AudienceOption {
  value: AudienceKind
  label: string
}

const AUDIENCE_OPTIONS: ReadonlyArray<AudienceOption> = [
  { value: 'officials', label: 'Tous les officiels' },
  { value: 'officials_level', label: 'Officiels par niveau' },
  { value: 'team', label: "Membres d'une équipe" },
  { value: 'custom', label: 'Sélection personnalisée' },
]

/** Comptes mock par niveau (count de destinataires). */
const OFFICIALS_BY_LEVEL: Record<1 | 2 | 3, number> = { 1: 4, 2: 5, 3: 3 }
/** Comptage global "Tous les officiels". */
const TOTAL_OFFICIALS = 12

interface DeepLinkOption {
  value: string
  label: string
}

const DEEP_LINK_OPTIONS: ReadonlyArray<DeepLinkOption> = [
  { value: '', label: 'Aucun' },
  { value: 'match:match-csjc-pully', label: 'Match · BC Aigles vs Pully BC (18 oct.)' },
  { value: 'team:t-u16m-compet', label: 'Équipe · U16M Compétition' },
  { value: 'open-matches', label: 'Liste des matchs à pourvoir' },
]

// ────────────────────────────────────────────────────────────────
// Pool custom — 8 membres tirés de MOCK_MEMBERS (priorité aux licenciés
// joueurs / officiels pour un mock réaliste).
// ────────────────────────────────────────────────────────────────

const CUSTOM_POOL: ReadonlyArray<MockMember> = MOCK_MEMBERS.filter(
  (m) => m.licenseNumber != null,
).slice(0, 8)

// ────────────────────────────────────────────────────────────────
// Form state
// ────────────────────────────────────────────────────────────────

const type = ref<BroadcastType>('officials_needed')
const audience = ref<AudienceKind>('officials')
const audienceLevel = ref<1 | 2 | 3>(2)
const audienceTeamId = ref<string>('')
const customSelected = ref<Set<string>>(new Set())

const title = ref<string>('')
const message = ref<string>('')
const deepLink = ref<string>('')

const TITLE_MAX = 80
const MESSAGE_MAX = 500

const teamOptions = computed<ReadonlyArray<MockTeam>>(() => listTeams())

// Initialise la team par défaut si on a au moins une équipe.
const firstTeamId = teamOptions.value[0]?.id ?? ''
if (firstTeamId && !audienceTeamId.value) {
  audienceTeamId.value = firstTeamId
}

// ────────────────────────────────────────────────────────────────
// Compteurs de destinataires
// ────────────────────────────────────────────────────────────────

const recipientCount = computed<number>(() => {
  switch (audience.value) {
    case 'officials':
      return TOTAL_OFFICIALS
    case 'officials_level':
      return OFFICIALS_BY_LEVEL[audienceLevel.value] ?? 0
    case 'team': {
      const team = teamOptions.value.find((t) => t.id === audienceTeamId.value) ?? null
      return team?.playerIds.length ?? 0
    }
    case 'custom':
      return customSelected.value.size
    default:
      return 0
  }
})

// ────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────

const titleTrimmed = computed(() => title.value.trim())
const messageTrimmed = computed(() => message.value.trim())

const titleValid = computed(() => titleTrimmed.value.length > 0 && titleTrimmed.value.length <= TITLE_MAX)
const messageValid = computed(
  () => messageTrimmed.value.length > 0 && messageTrimmed.value.length <= MESSAGE_MAX,
)

const audienceValid = computed<boolean>(() => {
  switch (audience.value) {
    case 'officials':
      return true
    case 'officials_level':
      return audienceLevel.value >= 1 && audienceLevel.value <= 3
    case 'team':
      return audienceTeamId.value.length > 0
    case 'custom':
      return customSelected.value.size > 0
    default:
      return false
  }
})

const canSubmit = computed(() => titleValid.value && messageValid.value && audienceValid.value)

// Compteur live message (au-dessus du max → on bloque mais on affiche).
const messageRemaining = computed(() => MESSAGE_MAX - messageTrimmed.value.length)
const titleRemaining = computed(() => TITLE_MAX - titleTrimmed.value.length)

// ────────────────────────────────────────────────────────────────
// Aperçu — visible quand l'utilisateur clique "Aperçu" et qu'il y a
// au moins un titre + un message saisis.
// ────────────────────────────────────────────────────────────────

const showPreview = ref<boolean>(false)

const previewType = computed(() => TYPE_TO_NOTIF_ICON[type.value])
const previewTitle = computed(() => titleTrimmed.value || 'Titre de la notification')
const previewExtract = computed(() => {
  const msg = messageTrimmed.value
  if (!msg) return 'Le message apparaîtra ici.'
  return msg.length > 100 ? `${msg.slice(0, 100)}…` : msg
})

function togglePreview(): void {
  showPreview.value = !showPreview.value
}

// ────────────────────────────────────────────────────────────────
// Custom multi-select (chips checkables)
// ────────────────────────────────────────────────────────────────

function toggleCustom(memberId: string): void {
  const next = new Set(customSelected.value)
  if (next.has(memberId)) {
    next.delete(memberId)
  } else {
    next.add(memberId)
  }
  customSelected.value = next
}

function isCustomSelected(memberId: string): boolean {
  return customSelected.value.has(memberId)
}

function memberLabel(m: MockMember): string {
  return `${m.firstName} ${m.lastName}`
}

// ────────────────────────────────────────────────────────────────
// Confirmation modal
// ────────────────────────────────────────────────────────────────

const confirmOpen = ref<boolean>(false)

function openConfirm(): void {
  if (!canSubmit.value) return
  confirmOpen.value = true
}

function closeConfirm(): void {
  confirmOpen.value = false
}

// ────────────────────────────────────────────────────────────────
// Actions
// ────────────────────────────────────────────────────────────────

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function onSubmit(): void {
  if (!canSubmit.value) return
  // Compose le payload audience (compact + sans clés inutiles).
  const audiencePayload: Record<string, unknown> = { kind: audience.value }
  if (audience.value === 'officials_level') audiencePayload['level'] = audienceLevel.value
  if (audience.value === 'team') audiencePayload['teamId'] = audienceTeamId.value
  if (audience.value === 'custom') audiencePayload['memberIds'] = Array.from(customSelected.value)

  logMockAction('a4.broadcast', {
    type: type.value,
    audience: audiencePayload,
    title: titleTrimmed.value,
    message: messageTrimmed.value,
    deepLink: deepLink.value || null,
    recipientCount: recipientCount.value,
  })
  confirmOpen.value = false
  onBack()
}

// ────────────────────────────────────────────────────────────────
// Shells nav (mobile tab bar + desktop sidebar)
// ────────────────────────────────────────────────────────────────

const notifBadgeCount = computed(() => countUnread())

const tabsAdmin = computed<CbTab[]>(() => [
  { icon: BellRing, label: 'Staffing' },
  { icon: Inbox, label: 'Demandes' },
  { icon: Megaphone, label: 'Diffuser' },
  { icon: Bell, label: 'Notifs', badge: notifBadgeCount.value || undefined },
])

function onTabSelect(index: number): void {
  if (index === 0) void router.push({ name: 'staffing' })
  if (index === 1) void router.push({ name: 'requests' })
  if (index === 2) return // courant
  if (index === 3) void router.push({ name: 'notifications' })
}

function onNotifClick(): void {
  void router.push({ name: 'notifications' })
}

const navAdmin = computed<CbNavItem[]>(() => [
  { icon: HomeIcon, label: 'Accueil' },
  { icon: BellRing, label: 'Staffing' },
  { icon: Inbox, label: 'Demandes' },
  { icon: Megaphone, label: 'Diffuser' },
  { icon: Bell, label: 'Notifications', badge: notifBadgeCount.value || undefined },
])

function onNavSelect(index: number): void {
  if (index === 0) void router.push({ name: 'home' })
  if (index === 1) void router.push({ name: 'staffing' })
  if (index === 2) void router.push({ name: 'requests' })
  if (index === 3) return // courant
  if (index === 4) void router.push({ name: 'notifications' })
}

// Sous-titre desktop : indication du compteur.
const desktopSubtitle = computed(
  () => `${recipientCount.value} destinataire${recipientCount.value > 1 ? 's' : ''} ciblé${recipientCount.value > 1 ? 's' : ''}`,
)
</script>

<template>
  <!-- ─── Mobile shell ───────────────────────────────────────── -->
  <CbMobileShell
    v-if="!isDesktop"
    class="a4-mobile"
    title="Diffuser"
    club="BCA"
    :notif-badge="notifBadgeCount > 0"
    :tabs="tabsAdmin"
    :active-tab="2"
    @notif-click="onNotifClick"
    @tab-select="onTabSelect"
  >
    <div class="cb-page">
      <div>
        <div class="cb-h2">Envoyer une notification</div>
        <div class="cb-sub" style="margin-top: 4px">
          Push immédiat et notification in-app aux destinataires sélectionnés.
        </div>
      </div>

      <!-- Type -->
      <div class="cb-field">
        <label for="a4-type">Type</label>
        <select id="a4-type" v-model="type" class="cb-input">
          <option v-for="opt in TYPE_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <!-- Audience -->
      <div class="cb-field">
        <label>Audience</label>
        <div class="a4-radios">
          <label
            v-for="opt in AUDIENCE_OPTIONS"
            :key="opt.value"
            class="a4-radio"
            :class="{ active: audience === opt.value }"
          >
            <input
              type="radio"
              name="a4-audience"
              :value="opt.value"
              :checked="audience === opt.value"
              @change="audience = opt.value"
            />
            <span class="a4-radio-label">{{ opt.label }}</span>
            <span v-if="audience === opt.value" class="a4-radio-count mono">
              {{ recipientCount }}
            </span>
          </label>
        </div>

        <!-- Sous-sélecteur niveau -->
        <div v-if="audience === 'officials_level'" class="cb-field" style="margin-top: 10px">
          <label for="a4-level">Niveau</label>
          <select id="a4-level" v-model.number="audienceLevel" class="cb-input">
            <option :value="1">Niveau 1</option>
            <option :value="2">Niveau 2</option>
            <option :value="3">Niveau 3</option>
          </select>
        </div>

        <!-- Sous-sélecteur équipe -->
        <div v-if="audience === 'team'" class="cb-field" style="margin-top: 10px">
          <label for="a4-team">Équipe</label>
          <select id="a4-team" v-model="audienceTeamId" class="cb-input">
            <option v-for="t in teamOptions" :key="t.id" :value="t.id">
              {{ t.name }} ({{ t.playerIds.length }})
            </option>
          </select>
        </div>

        <!-- Sous-sélecteur custom (chips checkables) -->
        <div v-if="audience === 'custom'" class="cb-field" style="margin-top: 10px">
          <label>Membres ciblés</label>
          <div class="a4-chips">
            <button
              v-for="m in CUSTOM_POOL"
              :key="m.id"
              type="button"
              class="a4-chip"
              :class="{ active: isCustomSelected(m.id) }"
              @click="toggleCustom(m.id)"
            >
              <Users :size="12" />
              {{ memberLabel(m) }}
            </button>
          </div>
          <div class="cb-helper">
            {{ customSelected.size }} membre{{ customSelected.size > 1 ? 's' : '' }} sélectionné{{
              customSelected.size > 1 ? 's' : ''
            }}.
          </div>
        </div>
      </div>

      <!-- Titre -->
      <div class="cb-field">
        <label for="a4-title">Titre</label>
        <input
          id="a4-title"
          v-model="title"
          type="text"
          class="cb-input"
          :maxlength="TITLE_MAX"
          placeholder="Ex. Officiels recherchés samedi"
          required
        />
        <div class="cb-helper">
          {{ titleTrimmed.length }} / {{ TITLE_MAX }} caractères.
        </div>
      </div>

      <!-- Message -->
      <div class="cb-field">
        <label for="a4-message">Message</label>
        <textarea
          id="a4-message"
          v-model="message"
          class="cb-input"
          rows="4"
          :maxlength="MESSAGE_MAX"
          placeholder="Ex. 3 matchs domicile samedi 18.10 manquent encore 5 officiels niveau 1+. Merci de vous inscrire depuis l'app si vous êtes disponibles."
          required
        />
        <div class="cb-helper">
          {{ messageTrimmed.length }} / {{ MESSAGE_MAX }} caractères ({{
            messageRemaining
          }}
          restants).
        </div>
      </div>

      <!-- Deep-link -->
      <div class="cb-field">
        <label for="a4-deeplink">Deep-link (optionnel)</label>
        <select id="a4-deeplink" v-model="deepLink" class="cb-input">
          <option v-for="opt in DEEP_LINK_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <!-- Aperçu mobile (visible quand toggle on) -->
      <div v-if="showPreview" class="a4-preview">
        <div class="cb-section-label" style="padding: 0 0 6px">Aperçu</div>
        <div class="cb-card" style="padding: 12px">
          <CbNotifItem
            :type="previewType"
            :title="previewTitle"
            :extract="previewExtract"
            time="À l'instant"
            :unread="true"
          />
        </div>
      </div>
    </div>

    <!-- Sticky bottom CTAs -->
    <CbBottomBar>
      <button
        type="button"
        class="cb-btn outline"
        style="flex: 1"
        @click="togglePreview"
      >
        <Eye :size="16" />
        {{ showPreview ? 'Masquer' : 'Aperçu' }}
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 2"
        :disabled="!canSubmit"
        @click="openConfirm"
      >
        <Send :size="16" /> Envoyer
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Desktop shell (≥1024 px) ───────────────────────────── -->
  <CbDesktopShell
    v-else
    class="a4-desktop"
    :items="navAdmin"
    :active="3"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="auth.displayName"
    user-role="Admin restreint"
    @nav-select="onNavSelect"
  >
    <CbPageHead title="Envoyer une notification" :subtitle="desktopSubtitle">
      <template #actions>
        <button type="button" class="cb-btn ghost" @click="onBack">Annuler</button>
        <button
          type="button"
          class="cb-btn primary"
          :disabled="!canSubmit"
          @click="openConfirm"
        >
          <Send :size="16" /> Envoyer
        </button>
      </template>
    </CbPageHead>

    <div class="a4-desktop-body">
      <!-- Colonne form -->
      <div class="cb-card a4-desktop-card">
        <div>
          <div class="cb-h3">Contenu</div>
          <div class="cb-sub" style="margin-top: 2px">
            Type, audience, titre, message et destination de tap.
          </div>
        </div>

        <div class="cb-field">
          <label for="a4-d-type">Type</label>
          <select id="a4-d-type" v-model="type" class="cb-input">
            <option v-for="opt in TYPE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="cb-field">
          <label>Audience</label>
          <div class="a4-radios">
            <label
              v-for="opt in AUDIENCE_OPTIONS"
              :key="opt.value"
              class="a4-radio"
              :class="{ active: audience === opt.value }"
            >
              <input
                type="radio"
                name="a4-d-audience"
                :value="opt.value"
                :checked="audience === opt.value"
                @change="audience = opt.value"
              />
              <span class="a4-radio-label">{{ opt.label }}</span>
              <span v-if="audience === opt.value" class="a4-radio-count mono">
                {{ recipientCount }}
              </span>
            </label>
          </div>

          <div v-if="audience === 'officials_level'" class="cb-field" style="margin-top: 10px">
            <label for="a4-d-level">Niveau</label>
            <select id="a4-d-level" v-model.number="audienceLevel" class="cb-input">
              <option :value="1">Niveau 1</option>
              <option :value="2">Niveau 2</option>
              <option :value="3">Niveau 3</option>
            </select>
          </div>

          <div v-if="audience === 'team'" class="cb-field" style="margin-top: 10px">
            <label for="a4-d-team">Équipe</label>
            <select id="a4-d-team" v-model="audienceTeamId" class="cb-input">
              <option v-for="t in teamOptions" :key="t.id" :value="t.id">
                {{ t.name }} ({{ t.playerIds.length }})
              </option>
            </select>
          </div>

          <div v-if="audience === 'custom'" class="cb-field" style="margin-top: 10px">
            <label>Membres ciblés</label>
            <div class="a4-chips">
              <button
                v-for="m in CUSTOM_POOL"
                :key="m.id"
                type="button"
                class="a4-chip"
                :class="{ active: isCustomSelected(m.id) }"
                @click="toggleCustom(m.id)"
              >
                <Users :size="12" />
                {{ memberLabel(m) }}
              </button>
            </div>
            <div class="cb-helper">
              {{ customSelected.size }} membre{{ customSelected.size > 1 ? 's' : '' }} sélectionné{{
                customSelected.size > 1 ? 's' : ''
              }}.
            </div>
          </div>
        </div>

        <div class="cb-field">
          <label for="a4-d-title">Titre</label>
          <input
            id="a4-d-title"
            v-model="title"
            type="text"
            class="cb-input"
            :maxlength="TITLE_MAX"
            placeholder="Ex. Officiels recherchés samedi"
            required
          />
          <div class="cb-helper">
            {{ titleTrimmed.length }} / {{ TITLE_MAX }} caractères.
          </div>
        </div>

        <div class="cb-field">
          <label for="a4-d-message">Message</label>
          <textarea
            id="a4-d-message"
            v-model="message"
            class="cb-input"
            rows="5"
            :maxlength="MESSAGE_MAX"
            placeholder="Ex. 3 matchs domicile samedi 18.10 manquent encore 5 officiels niveau 1+. Merci de vous inscrire depuis l'app si vous êtes disponibles."
            required
          />
          <div class="cb-helper">
            {{ messageTrimmed.length }} / {{ MESSAGE_MAX }} caractères ({{
              messageRemaining
            }}
            restants).
          </div>
        </div>

        <div class="cb-field">
          <label for="a4-d-deeplink">Deep-link (optionnel)</label>
          <select id="a4-d-deeplink" v-model="deepLink" class="cb-input">
            <option v-for="opt in DEEP_LINK_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="a4-desktop-actions">
          <button type="button" class="cb-btn outline" @click="togglePreview">
            <Eye :size="16" />
            {{ showPreview ? 'Masquer aperçu' : 'Aperçu' }}
          </button>
          <button
            type="button"
            class="cb-btn primary"
            :disabled="!canSubmit"
            @click="openConfirm"
          >
            <Send :size="16" /> Envoyer
          </button>
        </div>
      </div>

      <!-- Colonne aperçu sticky -->
      <aside class="a4-desktop-preview">
        <div class="cb-card a4-preview-card">
          <div class="cb-section-label" style="padding: 0 0 8px">Aperçu temps réel</div>
          <div class="cb-card" style="padding: 12px; background: var(--bg-muted)">
            <CbNotifItem
              :type="previewType"
              :title="previewTitle"
              :extract="previewExtract"
              time="À l'instant"
              :unread="true"
            />
          </div>
          <div class="cb-sub" style="margin-top: 12px; line-height: 1.4">
            <strong style="color: var(--text)">{{ recipientCount }} destinataire{{
              recipientCount > 1 ? 's' : ''
            }}</strong>
            recevront cette notification (push + in-app).
          </div>
        </div>
      </aside>
    </div>
  </CbDesktopShell>

  <!-- ─── Confirmation modal (mobile + desktop) ──────────────── -->
  <Teleport to="body">
    <div
      v-if="confirmOpen"
      class="a4-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmer l'envoi"
      @click.self="closeConfirm"
    >
      <div class="a4-dialog">
        <div class="a4-dialog-head">
          <h2 class="cb-h2">Confirmer l'envoi</h2>
          <button
            type="button"
            class="cb-iconbtn"
            aria-label="Fermer"
            @click="closeConfirm"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="a4-dialog-body">
          <p class="cb-sub" style="line-height: 1.5">
            Cette notification sera envoyée à
            <strong style="color: var(--text)">
              {{ recipientCount }} destinataire{{ recipientCount > 1 ? 's' : '' }} </strong
            >. Push et notification in-app instantanés.
          </p>
          <div
            class="cb-card"
            style="margin-top: 14px; padding: 12px; background: var(--bg-muted)"
          >
            <CbNotifItem
              :type="previewType"
              :title="previewTitle"
              :extract="previewExtract"
              time="À l'instant"
              :unread="true"
            />
          </div>
          <div
            v-if="type === 'urgent'"
            style="margin-top: 12px; display: flex; gap: 8px; align-items: center; padding: 10px 12px; background: var(--rose-50, #fff1f2); border: 1px solid var(--rose-200, #fecdd3); border-radius: 8px"
          >
            <AlertTriangle :size="16" style="color: var(--rose-700, #be123c); flex-shrink: 0" />
            <div class="cb-sub" style="color: var(--rose-700, #be123c); line-height: 1.4">
              Type "Urgent" — cette notification déclenchera une alerte sonore
              sur les appareils des destinataires.
            </div>
          </div>
        </div>
        <div class="a4-dialog-actions">
          <button type="button" class="cb-btn outline" @click="closeConfirm">
            Annuler
          </button>
          <button type="button" class="cb-btn primary" @click="onSubmit">
            <Send :size="16" /> Confirmer l'envoi
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Responsive shells ──────────────────────────────────── */
.a4-mobile { display: flex; }
.a4-desktop { display: none; }
@media (min-width: 1024px) {
  .a4-mobile { display: none; }
  .a4-desktop { display: flex; }
}

/* ─── Radios audience (card-style) ───────────────────────── */
.a4-radios {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.a4-radio {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.a4-radio.active {
  border-color: var(--emerald-500);
  background: var(--emerald-50);
}
.a4-radio input[type='radio'] {
  width: 16px;
  height: 16px;
  accent-color: var(--emerald-600);
  flex-shrink: 0;
}
.a4-radio-label {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.a4-radio.active .a4-radio-label {
  font-weight: 600;
}
.a4-radio-count {
  font-size: 12px;
  font-weight: 700;
  color: var(--emerald-700);
  background: var(--emerald-100, #d1fae5);
  padding: 2px 8px;
  border-radius: 999px;
}

/* ─── Chips custom multi-select ──────────────────────────── */
.a4-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.a4-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.a4-chip:hover {
  border-color: var(--emerald-400, var(--emerald-500));
}
.a4-chip.active {
  border-color: var(--emerald-500);
  background: var(--emerald-50);
  color: var(--emerald-700);
  font-weight: 600;
}

/* ─── Aperçu mobile ──────────────────────────────────────── */
.a4-preview {
  margin-top: 4px;
}

/* ─── Desktop layout 2 colonnes ──────────────────────────── */
.a4-desktop-body {
  flex: 1;
  overflow: auto;
  padding: 28px;
  background: var(--bg-muted);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
}
.a4-desktop-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.a4-desktop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.a4-desktop-preview {
  position: sticky;
  top: 28px;
}
.a4-preview-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1280px) {
  .a4-desktop-body {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}

/* ─── Dialog modal ───────────────────────────────────────── */
.a4-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}
.a4-dialog {
  background: var(--bg);
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.a4-dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.a4-dialog-body {
  padding: 18px;
}
.a4-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--border);
  background: var(--slate-50, var(--bg));
}

@media (max-width: 480px) {
  .a4-dialog-backdrop {
    align-items: flex-end;
    padding: 0;
  }
  .a4-dialog {
    border-radius: 16px 16px 0 0;
    max-width: 100%;
  }
}
</style>
