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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  getMember as getMemberMock,
  getTeam,
  logMockAction,
  type MockMember,
} from '@/repositories/mock'
import {
  getMember as getMemberReal,
  getMemberContact,
} from '@/repositories/members.repo'
import {
  coachUpdateMember,
  coachDeactivateMember,
} from '@/services/cloudFunctions'
import { useAuthStore } from '@/stores/auth'

// ────────────────────────────────────────────────────────────────
// Props (router) — null = create, string = edit
// ────────────────────────────────────────────────────────────────

const props = defineProps<{
  memberId: string | null
}>()

const router = useRouter()
const auth = useAuthStore()

const mode = computed<'create' | 'edit'>(() => (props.memberId ? 'edit' : 'create'))

/**
 * Mode hybride (cf. `apps/courtbase-app/CLAUDE.md`) :
 *   - `useRealFirestore = true` quand le coach a un `userDoc.memberId` lié.
 *     `existingMember` lit via `getMemberReal` (async, refs `realMember` /
 *     `realLoading`), et le submit appelle la callable `coachUpdateMember`.
 *   - `false` → fallback mock (mode démo /_design). Mêmes vues, mêmes refs,
 *     mais lecture mock + `logMockAction` au submit.
 */
const useRealFirestore = computed<boolean>(() => !!auth.userDoc?.memberId)

/** Member chargé en async (mode firestore). Null en mode mock. */
const realMember = ref<MockMember | null>(null)
/** True pendant le fetch (mode firestore uniquement). */
const realLoading = ref(false)

const existingMember = computed<MockMember | null>(() => {
  if (!props.memberId) return null
  if (useRealFirestore.value) return realMember.value
  return getMemberMock(props.memberId)
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

/**
 * État initial du formulaire en mode mock — utilisé tant que le fetch
 * firestore n'a pas résolu (sinon le form serait undefined). En mode firestore,
 * `applyMemberToForm` réinitialise les champs après réception du doc.
 */
function initialState(): FormState {
  const m = existingMember.value
  if (m && !useRealFirestore.value) {
    // JSX defaults pour le mode edit mock (Théo).
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

/**
 * Recopie les champs d'un member réel + contact dans `form`. Les rôles ne
 * sont pas pilotables côté coach (rules + whitelist `coachUpdateMember`) —
 * on les laisse à `player: true` par défaut.
 */
function applyMemberToForm(m: MockMember, contact: { email: string | null; phone: string | null } | null): void {
  form.value = {
    firstName: m.firstName,
    lastName: m.lastName,
    birthDate: m.birthDate,
    gender: m.gender === 'F' ? 'F' : m.gender === 'other' ? 'other' : 'M',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    avs: m.avs ?? '',
    roles: {
      player: true,
      official: m.officialLevel !== null,
      coach: false,
      referee: false,
    },
  }
}

/**
 * Charge le member réel + son sous-doc contact (mode firestore). En mode mock,
 * no-op (le state initial suffit). Re-fetché si `props.memberId` change.
 */
async function loadFromFirestore(id: string): Promise<void> {
  if (!useRealFirestore.value || !id) return
  realLoading.value = true
  realMember.value = null
  try {
    const [m, contact] = await Promise.all([getMemberReal(id), getMemberContact(id)])
    realMember.value = m
    if (m) applyMemberToForm(m, contact)
  } finally {
    realLoading.value = false
  }
}

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

const deactivateError = ref<string | null>(null)
const deactivateSubmitting = ref(false)

async function submitDeactivate(): Promise<void> {
  if (!deactivateConfirmed.value || !props.memberId) return
  deactivateError.value = null
  if (useRealFirestore.value) {
    deactivateSubmitting.value = true
    try {
      await coachDeactivateMember({ memberId: props.memberId, mode: 'bench' })
      closeDeactivateDialog()
      onBack()
    } catch (err) {
      console.error('[co3] coachDeactivateMember failed', err)
      const code = (err as { code?: string } | null)?.code ?? ''
      deactivateError.value =
        code === 'permission-denied'
          ? "Vous n'êtes pas autorisé à désactiver ce joueur."
          : 'La désactivation a échoué. Réessayez.'
    } finally {
      deactivateSubmitting.value = false
    }
    return
  }
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

/** True pendant `coachUpdateMember` (mode firestore). Désactive le CTA "Enregistrer". */
const submitting = ref(false)
const submitError = ref<string | null>(null)

/**
 * Convertit la string `yyyy-mm-dd` en epoch millis (UTC midnight) attendu par
 * `coachUpdateMember`. Renvoie `null` si la string est vide (laisse le champ
 * inchangé en passant `undefined` plus haut).
 */
function birthDateToMillis(iso: string): number | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map((p) => Number(p))
  if (y === undefined || m === undefined || d === undefined) return null
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  return Date.UTC(y, m - 1, d)
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  submitError.value = null

  // Mode mock — comportement legacy (log-only, navigate back).
  if (!useRealFirestore.value) {
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
    return
  }

  // Mode firestore — mode create pas branché (callable `coachCreateMember`
  // demande un teamId qu'on n'a pas ici). On dirige vers le mock pour
  // l'instant pour ne pas bloquer le mode démo.
  if (mode.value === 'create' || !props.memberId) {
    logMockAction('co3.create.skipped-firestore', {
      ...form.value,
      reason: 'coachCreateMember requires teamId — not wired in MemberForm yet',
    })
    onBack()
    return
  }

  // Mode firestore + edit — appelle `coachUpdateMember` avec la whitelist.
  submitting.value = true
  try {
    const birthMs = birthDateToMillis(form.value.birthDate)
    await coachUpdateMember({
      memberId: props.memberId,
      firstName: form.value.firstName.trim(),
      lastName: form.value.lastName.trim(),
      birthDate: birthMs, // null si vide — efface (rare en edit)
      email: form.value.email.trim() || null,
      phone: form.value.phone.trim() || null,
    })
    onBack()
  } catch (err) {
    console.error('[co3] coachUpdateMember failed', err)
    const code = (err as { code?: string } | null)?.code ?? ''
    submitError.value =
      code === 'permission-denied'
        ? "Vous n'êtes pas autorisé à modifier ce joueur."
        : code === 'invalid-argument'
          ? 'Un des champs est invalide. Vérifiez le formulaire.'
          : "L'enregistrement a échoué. Réessayez."
  } finally {
    submitting.value = false
  }
}

// ────────────────────────────────────────────────────────────────
// Click outside — ferme le menu kebab
// ────────────────────────────────────────────────────────────────

function onWindowClick(): void {
  if (kebabMenuOpen.value) closeKebab()
}

onMounted(() => {
  window.addEventListener('click', onWindowClick)
  if (mode.value === 'edit' && props.memberId) {
    void loadFromFirestore(props.memberId)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
})

// Refetch si le memberId change (deep-link sur edit avec autre id pendant
// même montage — rare mais correct).
watch(
  () => [useRealFirestore.value, props.memberId] as const,
  ([, id]) => {
    if (mode.value === 'edit' && id) void loadFromFirestore(id)
  },
)

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
      <!-- Loader pendant le fetch initial (mode firestore) -->
      <CbBanner
        v-if="useRealFirestore && realLoading"
        tone="sky"
      >
        Chargement du joueur…
      </CbBanner>

      <!-- Bannière "qui peut faire quoi" en mode firestore -->
      <CbBanner
        v-if="useRealFirestore && mode === 'edit'"
        tone="sky"
      >
        Vous pouvez modifier le prénom, le nom, la date de naissance,
        l'email et le téléphone. L'AVS, les rôles et les tuteurs sont gérés
        par l'admin.
      </CbBanner>

      <!-- Erreur submit / désactivation (callable) -->
      <CbBanner
        v-if="submitError"
        tone="rose"
      >
        {{ submitError }}
      </CbBanner>
      <CbBanner
        v-if="deactivateError"
        tone="rose"
      >
        {{ deactivateError }}
      </CbBanner>

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
              :disabled="useRealFirestore"
              :readonly="useRealFirestore"
            />
            <div class="cb-helper">
              <template v-if="useRealFirestore">
                L'AVS est géré par l'admin (sensible).
              </template>
              <template v-else>
                Obligatoire pour établir la licence fédérale.
              </template>
            </div>
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
            v-if="!useRealFirestore"
            type="button"
            class="cb-btn outline block sm"
            @click="openLinkGuardian"
          >
            <Plus :size="14" /> Lier un tuteur
          </button>
          <div v-else class="cb-helper">Les liens tuteur sont gérés par l'admin.</div>
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
            <input v-model="form.roles.player" type="checkbox" :disabled="useRealFirestore" />
            <span>Joueur</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.official" type="checkbox" :disabled="useRealFirestore" />
            <span>Officiel</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.coach" type="checkbox" :disabled="useRealFirestore" />
            <span>Coach</span>
          </label>
          <label style="display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 8px 0">
            <input v-model="form.roles.referee" type="checkbox" :disabled="useRealFirestore" />
            <span>Arbitre</span>
          </label>
          <div v-if="useRealFirestore" class="cb-helper">Les rôles sont gérés par l'admin.</div>
        </div>
      </div>
    </div>

    <CbBottomBar>
      <button
        type="button"
        class="cb-btn outline"
        style="flex: 1"
        :disabled="submitting"
        @click="onCancel"
      >
        Annuler
      </button>
      <button
        type="button"
        class="cb-btn primary"
        style="flex: 2"
        :disabled="!canSubmit || submitting"
        @click="onSubmit"
      >
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
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
            :disabled="deactivateSubmitting"
            @click="closeDeactivateDialog"
          >
            Annuler
          </button>
          <button
            type="button"
            class="cb-btn danger"
            style="flex: 2"
            :disabled="!deactivateConfirmed || deactivateSubmitting"
            @click="submitDeactivate"
          >
            {{ deactivateSubmitting ? 'Désactivation…' : 'Désactiver' }}
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
