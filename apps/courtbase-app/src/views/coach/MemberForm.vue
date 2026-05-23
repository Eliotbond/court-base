<script setup lang="ts">
/**
 * CO3 — Formulaire joueur (coach), création/édition.
 *
 * Transcription quasi-littérale du JSX `screens/coach.jsx` lignes 122-211
 * (`Collapsible`, `CO3Mobile`, `TypeToConfirmDialog`). Aucune réorganisation
 * de section : Identité, Contact, AVS, Tuteurs, Rôles — dans cet ordre.
 *
 * Modes :
 *   - `memberId === null`            → mode **create** ("Nouveau joueur").
 *   - `memberId` (string non vide)   → mode **edit** ("Modifier {prénom}"),
 *                                       pré-rempli via `getMember(memberId)`.
 *
 * Mock-only — `coachCreateMember`, `coachUpdateMember`, `coachDeactivateMember`
 * simulés via `logMockAction(...)` puis `router.back()`.
 *
 * Limitation connue : `CbMobileShell` rend toujours le kebab top-right. En
 * mode create il reste visible mais ne déclenche rien (le handler court-circuite
 * tout). À ouvrir un slot `right` côté shell le jour où on doit le masquer ailleurs.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Mail,
  Plus,
  Trash2,
  X,
} from 'lucide-vue-next'

import CbBanner from '@/components/ui/CbBanner.vue'
import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbMemberRow from '@/components/ui/CbMemberRow.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPill from '@/components/ui/CbPill.vue'
import {
  getMember,
  getTeam,
  logMockAction,
  type MockMember,
} from '@/repositories/mock'

// ────────────────────────────────────────────────────────────────
// Props (router) — null = create, string = edit
// ────────────────────────────────────────────────────────────────

const props = defineProps<{
  memberId: string | null
}>()

const router = useRouter()

const mode = computed<'create' | 'edit'>(() => (props.memberId ? 'edit' : 'create'))

const existingMember = computed<MockMember | null>(() => {
  if (!props.memberId) return null
  return getMember(props.memberId)
})

// ────────────────────────────────────────────────────────────────
// Form state — initialisé depuis le mock en mode edit
// ────────────────────────────────────────────────────────────────

interface FormState {
  firstName: string
  lastName: string
  birthDate: string
  gender: 'M' | 'F' | 'other'
  phone: string
  email: string
  avs: string
  roles: {
    player: boolean
    official: boolean
    coach: boolean
    referee: boolean
  }
}

function initialState(): FormState {
  const m = existingMember.value
  if (m) {
    // JSX defaults pour le mode edit (Théo).
    return {
      firstName: m.firstName,
      lastName: m.lastName,
      birthDate: m.birthDate,
      gender: m.gender === 'F' ? 'F' : m.gender === 'other' ? 'other' : 'M',
      phone: '+41 79 100 22 33',
      email: `${m.firstName.toLowerCase()}.${m.lastName.toLowerCase()}@…`,
      avs: m.avs ?? '756.1234.5678.97',
      roles: {
        player: true,
        official: m.officialLevel !== null,
        coach: false,
        referee: false,
      },
    }
  }
  return {
    firstName: '',
    lastName: '',
    birthDate: '',
    gender: 'M',
    phone: '',
    email: '',
    avs: '',
    roles: { player: true, official: false, coach: false, referee: false },
  }
}

const form = ref<FormState>(initialState())

// ────────────────────────────────────────────────────────────────
// Validation (AVS, basique)
// ────────────────────────────────────────────────────────────────

/** AVS Suisse : `756.XXXX.XXXX.XX`. */
const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

const avsValid = computed(() => AVS_REGEX.test(form.value.avs.trim()))

const canSubmit = computed(
  () =>
    form.value.firstName.trim() !== '' &&
    form.value.lastName.trim() !== '' &&
    form.value.birthDate.trim() !== '' &&
    (form.value.avs.trim() === '' || avsValid.value),
)

// ────────────────────────────────────────────────────────────────
// Tuteurs (mock, mode edit uniquement par défaut)
// ────────────────────────────────────────────────────────────────

interface MockGuardianRef {
  uid: string
  name: string
  relationship: 'Père' | 'Mère' | 'Tuteur'
  email: string
}

const MOCK_GUARDIAN_REFS: ReadonlyArray<MockGuardianRef> = [
  { uid: 'user-parent-1', name: 'Pascal Maillard', relationship: 'Père',  email: 'pascal.m@…' },
  { uid: 'user-parent-2', name: 'Claire Maillard', relationship: 'Mère', email: 'claire.m@…' },
]

const guardians = ref<MockGuardianRef[]>(
  existingMember.value && existingMember.value.guardianUserIds.length > 0
    ? MOCK_GUARDIAN_REFS.slice(0, existingMember.value.guardianUserIds.length)
    : mode.value === 'edit'
      ? [...MOCK_GUARDIAN_REFS]
      : [],
)

function openLinkGuardian(): void {
  logMockAction('co3.guardian-link-open', { memberId: props.memberId })
}

// ────────────────────────────────────────────────────────────────
// Collapsible sections (JSX defaultOpen)
// ────────────────────────────────────────────────────────────────

type SectionKey = 'identity' | 'contact' | 'avs' | 'guardians' | 'roles'

const openSections = ref<Record<SectionKey, boolean>>({
  identity: true,
  contact: false,
  avs: true,
  guardians: false,
  roles: false,
})

function toggleSection(k: SectionKey): void {
  openSections.value[k] = !openSections.value[k]
}

// ────────────────────────────────────────────────────────────────
// Kebab menu (edit mode) + dialog désactiver type-to-confirm
// ────────────────────────────────────────────────────────────────

const kebabMenuOpen = ref(false)

function onMoreClick(): void {
  if (mode.value !== 'edit') return
  kebabMenuOpen.value = !kebabMenuOpen.value
}

function closeKebab(): void {
  kebabMenuOpen.value = false
}

function onGoToDetail(): void {
  closeKebab()
  if (!props.memberId) return
  void router.push({ name: 'member', params: { memberId: props.memberId } })
}

const deactivateDialogOpen = ref(false)
const deactivateInput = ref('')
const DEACTIVATE_KEYWORD = 'désactiver'

function openDeactivateDialog(): void {
  closeKebab()
  deactivateInput.value = ''
  deactivateDialogOpen.value = true
}

function closeDeactivateDialog(): void {
  deactivateDialogOpen.value = false
}

const deactivateConfirmed = computed(
  () => deactivateInput.value.trim().toLowerCase() === DEACTIVATE_KEYWORD,
)

function submitDeactivate(): void {
  if (!deactivateConfirmed.value || !props.memberId) return
  logMockAction('co3.deactivate', { memberId: props.memberId })
  closeDeactivateDialog()
  onBack()
}

// ────────────────────────────────────────────────────────────────
// Actions principales — save / cancel
// ────────────────────────────────────────────────────────────────

function onBack(): void {
  if (window.history.length > 1) {
    router.back()
  } else {
    void router.push({ name: 'home' })
  }
}

function onCancel(): void {
  onBack()
}

function onSubmit(): void {
  if (!canSubmit.value) return
  const payload = {
    ...form.value,
    guardianUids: guardians.value.map((g) => g.uid),
  }
  if (mode.value === 'create') {
    logMockAction('co3.create', payload)
  } else {
    logMockAction('co3.save', { memberId: props.memberId, ...payload })
  }
  onBack()
}

// ────────────────────────────────────────────────────────────────
// Click outside — ferme le menu kebab
// ────────────────────────────────────────────────────────────────

function onWindowClick(): void {
  if (kebabMenuOpen.value) closeKebab()
}

onMounted(() => {
  window.addEventListener('click', onWindowClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
})

// ────────────────────────────────────────────────────────────────
// Headers / sous-titres
// ────────────────────────────────────────────────────────────────

const pageTitle = computed(() => {
  if (mode.value === 'create') return 'Nouveau joueur'
  const first = form.value.firstName || existingMember.value?.firstName || '…'
  return `Modifier ${first}`
})

const dialogSubtitle = computed(() => {
  const m = existingMember.value
  if (!m) return ''
  const fmt = m.birthDate
    .split('-')
    .reverse()
    .join('.')
  const team = getTeam(m.teamIds[0] ?? '')
  const teamName = team?.name ?? ''
  const lic = m.licenseNumber ? `n° licence ${m.licenseNumber}` : ''
  return [`Né le ${fmt}`, teamName, lic].filter((s) => s).join(' · ')
})
</script>

<template>
  <CbMobileShell
    class="co3-mobile"
    :title="pageTitle"
    show-back
    @back="onBack"
  >
    <div class="cb-page" style="padding-bottom: 16px">
      <!-- Kebab menu (mode edit uniquement) ─ ancré sous le header -->
      <div
        v-if="mode === 'edit' && kebabMenuOpen"
        class="co3-kebab-menu"
        role="menu"
        @click.stop
      >
        <button
          type="button"
          class="co3-kebab-item"
          role="menuitem"
          @click="onGoToDetail"
        >
          <ChevronRight :size="16" /> Voir la fiche détaillée
        </button>
        <button
          type="button"
          class="co3-kebab-item danger"
          role="menuitem"
          @click="openDeactivateDialog"
        >
          <Trash2 :size="16" /> Désactiver
        </button>
      </div>

      <!-- Capture du clic kebab (la cloche reste fonctionnelle) -->
      <button
        v-if="mode === 'edit'"
        type="button"
        class="co3-kebab-hit"
        aria-label="Plus d'options"
        @click.stop="onMoreClick"
      />

      <!-- ─── Identité ─────────────────────────────────────── -->
      <div class="cb-card" style="padding: 0; overflow: hidden">
        <button
          type="button"
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; background: transparent; padding: 14px; cursor: pointer; font-family: inherit; text-align: left"
          @click="toggleSection('identity')"
        >
          <div style="display: flex; align-items: center; gap: 8px">
            <div class="cb-h3">Identité</div>
          </div>
          <component
            :is="openSections.identity ? ChevronUp : ChevronDown"
            :size="18"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openSections.identity"
          style="padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px"
        >
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
            <div class="cb-field">
              <label>Prénom</label>
              <input v-model="form.firstName" class="cb-input" />
            </div>
            <div class="cb-field">
              <label>Nom</label>
              <input v-model="form.lastName" class="cb-input" />
            </div>
          </div>
          <div class="cb-field">
            <label>Date de naissance</label>
            <input v-model="form.birthDate" type="date" class="cb-input" />
          </div>
          <div class="cb-field">
            <label>Genre</label>
            <select v-model="form.gender" class="cb-input">
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
              <option value="other">Autre</option>
            </select>
          </div>
        </div>
      </div>

      <!-- ─── Contact ──────────────────────────────────────── -->
      <div class="cb-card" style="padding: 0; overflow: hidden">
        <button
          type="button"
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; background: transparent; padding: 14px; cursor: pointer; font-family: inherit; text-align: left"
          @click="toggleSection('contact')"
        >
          <div style="display: flex; align-items: center; gap: 8px">
            <div class="cb-h3">Contact</div>
          </div>
          <component
            :is="openSections.contact ? ChevronUp : ChevronDown"
            :size="18"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openSections.contact"
          style="padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px"
        >
          <div class="cb-field">
            <label>Téléphone</label>
            <input v-model="form.phone" class="cb-input" />
          </div>
          <div class="cb-field">
            <label>Email</label>
            <input v-model="form.email" class="cb-input" />
          </div>
        </div>
      </div>

      <!-- ─── AVS ──────────────────────────────────────────── -->
      <div class="cb-card" style="padding: 0; overflow: hidden">
        <button
          type="button"
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; background: transparent; padding: 14px; cursor: pointer; font-family: inherit; text-align: left"
          @click="toggleSection('avs')"
        >
          <div style="display: flex; align-items: center; gap: 8px">
            <div class="cb-h3">AVS</div>
            <CbPill v-if="avsValid" tone="emerald" dot>Valide</CbPill>
          </div>
          <component
            :is="openSections.avs ? ChevronUp : ChevronDown"
            :size="18"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openSections.avs"
          style="padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px"
        >
          <div class="cb-field">
            <label>Numéro AVS</label>
            <input
              v-model="form.avs"
              class="cb-input mono"
              placeholder="756.XXXX.XXXX.XX"
              inputmode="numeric"
              autocomplete="off"
            />
            <div class="cb-helper">Obligatoire pour établir la licence fédérale.</div>
          </div>
        </div>
      </div>

      <!-- ─── Tuteurs ──────────────────────────────────────── -->
      <div class="cb-card" style="padding: 0; overflow: hidden">
        <button
          type="button"
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; background: transparent; padding: 14px; cursor: pointer; font-family: inherit; text-align: left"
          @click="toggleSection('guardians')"
        >
          <div style="display: flex; align-items: center; gap: 8px">
            <div class="cb-h3">Tuteurs</div>
          </div>
          <component
            :is="openSections.guardians ? ChevronUp : ChevronDown"
            :size="18"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openSections.guardians"
          style="padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px"
        >
          <CbMemberRow
            v-for="g in guardians"
            :key="g.uid"
            :name="g.name"
            :sub="`${g.relationship} · ${g.email}`"
          >
            <template #pills>
              <CbPill tone="emerald" dot>Lié</CbPill>
            </template>
          </CbMemberRow>
          <button
            type="button"
            class="cb-btn outline block sm"
            @click="openLinkGuardian"
          >
            <Plus :size="14" /> Lier un tuteur
          </button>
        </div>
      </div>

      <!-- ─── Rôles ────────────────────────────────────────── -->
      <div class="cb-card" style="padding: 0; overflow: hidden">
        <button
          type="button"
          style="display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; background: transparent; padding: 14px; cursor: pointer; font-family: inherit; text-align: left"
          @click="toggleSection('roles')"
        >
          <div style="display: flex; align-items: center; gap: 8px">
            <div class="cb-h3">Rôles</div>
          </div>
          <component
            :is="openSections.roles ? ChevronUp : ChevronDown"
            :size="18"
            color="var(--slate-400)"
          />
        </button>
        <div
          v-if="openSections.roles"
          style="padding: 0 14px 14px; display: flex; flex-direction: column; gap: 12px"
        >
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.player" type="checkbox" />
            <span>Joueur</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.official" type="checkbox" />
            <span>Officiel</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.coach" type="checkbox" />
            <span>Coach</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.referee" type="checkbox" />
            <span>Arbitre</span>
          </label>
        </div>
      </div>
    </div>

    <CbBottomBar>
      <button
        type="button"
        class="cb-btn outline"
        style="flex: 1"
        @click="onCancel"
      >
        Annuler
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 2"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        Enregistrer
      </button>
    </CbBottomBar>
  </CbMobileShell>

  <!-- ─── Dialog type-to-confirm (désactiver) ─────────────── -->
  <Teleport to="body">
    <div
      v-if="deactivateDialogOpen"
      class="co3-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Désactiver le joueur"
      @click.self="closeDeactivateDialog"
    >
      <div class="co3-dialog">
        <div class="cb-header">
          <div class="left">
            <button
              type="button"
              class="cb-iconbtn"
              aria-label="Fermer"
              @click="closeDeactivateDialog"
            >
              <X :size="20" />
            </button>
          </div>
          <div class="title">Désactiver le joueur</div>
          <div class="right" />
        </div>
        <div class="cb-mobile-body plain">
          <div class="cb-page">
            <CbBanner tone="rose" title="Action irréversible">
              <template #icon><AlertTriangle :size="18" /></template>
              Une fois désactivé, ce joueur n'apparaîtra plus dans l'effectif.
              Sa fiche reste archivée mais n'est plus modifiable depuis l'app.
            </CbBanner>
            <div>
              <div class="cb-h3">{{ form.firstName }} {{ form.lastName }}</div>
              <div class="cb-sub">{{ dialogSubtitle }}</div>
            </div>
            <div class="cb-field">
              <label>
                Pour confirmer, tapez
                <span class="mono" style="color: var(--rose-700)">désactiver</span>
                ci-dessous
              </label>
              <input
                v-model="deactivateInput"
                class="cb-input mono"
                placeholder="désactiver"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
              />
            </div>
          </div>
        </div>
        <CbBottomBar>
          <button
            type="button"
            class="cb-btn outline"
            style="flex: 1"
            @click="closeDeactivateDialog"
          >
            Annuler
          </button>
          <button
            type="button"
            class="cb-btn danger"
            style="flex: 2"
            :disabled="!deactivateConfirmed"
            @click="submitDeactivate"
          >
            Désactiver
          </button>
        </CbBottomBar>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Hit-target invisible aligné sur le bouton kebab du CbHeader. Permet de
 * câbler le clic kebab vers `onMoreClick` sans modifier la primitive shell. */
.co3-kebab-hit {
  position: fixed;
  top: 8px;
  right: 8px;
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 50;
}

/* Kebab menu (ancré sous le header) */
.co3-kebab-menu {
  position: fixed;
  top: 56px;
  right: 8px;
  z-index: 60;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
  padding: 4px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
}
.co3-kebab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
  color: var(--text);
  border-radius: 8px;
  cursor: pointer;
}
.co3-kebab-item:hover {
  background: var(--slate-50);
}
.co3-kebab-item.danger {
  color: var(--rose-700);
}
.co3-kebab-item.danger:hover {
  background: var(--rose-50, #fff1f2);
}

/* Dialog type-to-confirm — full-bleed sur mobile, centré au-delà */
.co3-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  z-index: 1000;
}
.co3-dialog {
  background: var(--bg);
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (min-width: 540px) {
  .co3-dialog-backdrop {
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .co3-dialog {
    max-width: 480px;
    border-radius: 16px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  }
}
</style>
