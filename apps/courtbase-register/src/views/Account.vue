<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Globe,
  Lock,
  Mail,
  Save,
  Trash2,
  User as UserIcon,
  UserMinus,
} from 'lucide-vue-next'
import type {
  Member,
  MemberContactData,
} from '@club-app/shared-types'
import { useAuthStore } from '@/stores/auth'
import { useDuesStore } from '@/stores/dues'
import {
  getLinkedMember,
  getMemberContact,
  listMyDependents,
  updateMemberContact,
} from '@/repositories/members.repo'
import {
  deleteMyAccount,
  unlinkGuardian,
} from '@/services/cloudFunctions'

/**
 * Page « Mon compte » — self-service du user :
 *  - édition des infos user (`/users/{uid}` : displayName, phone, address) ;
 *  - lecture du profil joueur lié (`/members/{id}` si `userDoc.memberId`),
 *    avec édition du contact privé (`/members/{id}/private/contact`) car la
 *    rule autorise déjà l'écriture par `isLinkedMember` ;
 *  - liste des enfants liés (members où `guardianUserIds` contient le uid)
 *    avec action "Délier" via callable `unlinkGuardian` ;
 *  - zone dangereuse : suppression intégrale du compte via callable
 *    `deleteMyAccount` (refusée par le serveur tant qu'il y a un pupille
 *    restant ou un due `paid` sur le linked member).
 */
const auth = useAuthStore()
const dues = useDuesStore()
const router = useRouter()

// =============================================================================
// Section 1 — Infos user (form)
// =============================================================================

const displayName = ref('')
const email = ref('')
const phone = ref('')
const street = ref('')
const streetNumber = ref('')
const zip = ref('')
const city = ref('')
const country = ref('CH')

const userFormError = ref<string | null>(null)
const userFormSuccess = ref(false)
const savingUser = ref(false)

const emailVerified = computed(() => Boolean(auth.authSnap?.email))

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'CH', name: 'Suisse' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'IT', name: 'Italie' },
  { code: 'AT', name: 'Autriche' },
  { code: 'BE', name: 'Belgique' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'PT', name: 'Portugal' },
  { code: 'ES', name: 'Espagne' },
  { code: 'OTHER', name: 'Autre' },
]

/** Split "Rue de la gare 12" → { street: "Rue de la gare", num: "12" }. */
function splitStreet(full: string | undefined | null): { street: string; num: string } {
  if (!full) return { street: '', num: '' }
  const match = full.trim().match(/^(.*?)\s+([0-9][0-9a-zA-Z\-/]*)$/)
  if (match && match[1] && match[2]) {
    return { street: match[1].trim(), num: match[2].trim() }
  }
  return { street: full.trim(), num: '' }
}

function fillUserForm(): void {
  const doc = auth.userDoc
  displayName.value = doc?.displayName ?? auth.authSnap?.displayName ?? ''
  email.value = doc?.email ?? auth.authSnap?.email ?? ''
  phone.value = doc?.phone ?? ''
  const addr = doc?.address
  if (addr) {
    const parts = splitStreet(addr.street)
    street.value = parts.street
    streetNumber.value = parts.num
    zip.value = addr.zip ?? ''
    city.value = addr.city ?? ''
    country.value = addr.country ?? 'CH'
  } else {
    street.value = ''
    streetNumber.value = ''
    zip.value = ''
    city.value = ''
    country.value = 'CH'
  }
}

function validateUserForm(): string | null {
  if (!displayName.value.trim()) return 'Le nom est obligatoire.'
  if (!phone.value.trim()) return 'Le téléphone est obligatoire.'
  if (!street.value.trim()) return 'La rue est obligatoire.'
  if (!streetNumber.value.trim()) return 'Le numéro est obligatoire.'
  if (!zip.value.trim()) return 'Le code postal est obligatoire.'
  if (!city.value.trim()) return 'La ville est obligatoire.'
  return null
}

async function onSaveUser(): Promise<void> {
  userFormError.value = null
  userFormSuccess.value = false
  const v = validateUserForm()
  if (v) {
    userFormError.value = v
    return
  }
  savingUser.value = true
  try {
    await auth.saveProfile({
      displayName: displayName.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      address: {
        street: `${street.value.trim()} ${streetNumber.value.trim()}`.trim(),
        zip: zip.value.trim(),
        city: city.value.trim(),
        country: country.value,
      },
      photoURL: auth.userDoc?.photoURL ?? auth.authSnap?.photoURL ?? '',
    })
    userFormSuccess.value = true
    // Le toast disparaît après 2.5s.
    window.setTimeout(() => { userFormSuccess.value = false }, 2500)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`saveProfile failed [${code}]`, err)
    userFormError.value =
      err instanceof Error
        ? err.message
        : "Échec de l'enregistrement. Réessayez."
  } finally {
    savingUser.value = false
  }
}

// =============================================================================
// Section 2 — Profil joueur lié (linked member)
// =============================================================================

const linkedMember = ref<Member | null>(null)
const linkedContact = ref<MemberContactData | null>(null)
const loadingLinked = ref(false)
const linkedContactEmail = ref('')
const linkedContactPhone = ref('')
const savingLinkedContact = ref(false)
const linkedContactError = ref<string | null>(null)
const linkedContactSuccess = ref(false)

async function loadLinkedMember(): Promise<void> {
  const memberId = auth.userDoc?.memberId
  if (!memberId) {
    linkedMember.value = null
    linkedContact.value = null
    return
  }
  loadingLinked.value = true
  try {
    const [m, c] = await Promise.all([
      getLinkedMember(memberId),
      getMemberContact(memberId),
    ])
    linkedMember.value = m
    linkedContact.value = c
    linkedContactEmail.value = c?.email ?? auth.userDoc?.email ?? ''
    linkedContactPhone.value = c?.phone ?? auth.userDoc?.phone ?? ''
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`loadLinkedMember failed [${code}]`, err)
  } finally {
    loadingLinked.value = false
  }
}

async function onSaveLinkedContact(): Promise<void> {
  linkedContactError.value = null
  linkedContactSuccess.value = false
  const memberId = auth.userDoc?.memberId
  if (!memberId) return
  if (!linkedContactEmail.value.trim() || !linkedContactPhone.value.trim()) {
    linkedContactError.value = "Email et téléphone sont obligatoires."
    return
  }
  savingLinkedContact.value = true
  try {
    await updateMemberContact(memberId, {
      email: linkedContactEmail.value.trim(),
      phone: linkedContactPhone.value.trim(),
    })
    linkedContact.value = {
      email: linkedContactEmail.value.trim(),
      phone: linkedContactPhone.value.trim(),
    }
    linkedContactSuccess.value = true
    window.setTimeout(() => { linkedContactSuccess.value = false }, 2500)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`updateMemberContact failed [${code}]`, err)
    linkedContactError.value =
      "Impossible d'enregistrer ce contact. Vérifiez vos droits."
  } finally {
    savingLinkedContact.value = false
  }
}

// =============================================================================
// Section 3 — Enfants liés (dependents)
// =============================================================================

const dependents = ref<Member[]>([])
const loadingDependents = ref(false)
const unlinkingId = ref<string | null>(null)

async function loadDependents(): Promise<void> {
  if (!auth.authSnap?.uid) {
    dependents.value = []
    return
  }
  loadingDependents.value = true
  try {
    dependents.value = await listMyDependents(auth.authSnap.uid)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`listMyDependents failed [${code}]`, err)
    dependents.value = []
  } finally {
    loadingDependents.value = false
  }
}

async function onUnlinkDependent(member: Member): Promise<void> {
  const fullName = `${member.firstName} ${member.lastName}`.trim() || 'cet enfant'
  const ok = window.confirm(
    `Détacher ${fullName} de votre compte ?\n\n` +
      `Vous ne le verrez plus dans votre liste. Sa fiche reste gérée par le club. ` +
      `Pour vous re-rattacher, vous devrez contacter le club.`,
  )
  if (!ok) return
  unlinkingId.value = member.id
  try {
    await unlinkGuardian({ memberId: member.id })
    // Reload local — on retire le member de la liste sans refaire toute la
    // query (réactivité immédiate).
    dependents.value = dependents.value.filter((m) => m.id !== member.id)
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`unlinkGuardian failed [${code}]`, err)
    window.alert(
      "Impossible de détacher cet enfant. Réessayez plus tard ou contactez le club.",
    )
  } finally {
    unlinkingId.value = null
  }
}

// =============================================================================
// Section 4 — Zone dangereuse (delete account)
// =============================================================================

const showDeleteDialog = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)
const deleteError = ref<string | null>(null)

/** Liste les raisons UI qui bloquent la suppression (informative — le serveur reste autoritaire). */
const deleteBlockers = computed<string[]>(() => {
  const out: string[] = []
  if (dependents.value.length > 0) {
    out.push(
      `Vous avez ${dependents.value.length} enfant${dependents.value.length > 1 ? 's' : ''} lié${dependents.value.length > 1 ? 's' : ''} à votre compte. Déliez-${dependents.value.length > 1 ? 'les' : 'le'} d'abord.`,
    )
  }
  const memberId = auth.userDoc?.memberId
  if (memberId && dues.findPaidDueForMember(memberId)) {
    out.push(
      'Votre profil joueur a des cotisations déjà payées. Contactez le club pour archiver votre profil au lieu de le supprimer.',
    )
  }
  return out
})

const canAttemptDelete = computed(() => deleteBlockers.value.length === 0)

function openDeleteDialog(): void {
  if (!canAttemptDelete.value) return
  deleteConfirmText.value = ''
  deleteError.value = null
  showDeleteDialog.value = true
}

function closeDeleteDialog(): void {
  if (deleting.value) return
  showDeleteDialog.value = false
}

async function onConfirmDelete(): Promise<void> {
  deleteError.value = null
  if (deleteConfirmText.value.trim() !== 'SUPPRIMER') {
    deleteError.value = 'Tapez exactement « SUPPRIMER » pour confirmer.'
    return
  }
  deleting.value = true
  try {
    const result = await deleteMyAccount({ confirmText: 'SUPPRIMER' })
    // Sign-out best-effort (le compte Auth est déjà détruit côté serveur
    // si `authDeleted === true` — `signOut` ne fait que cleaner le state
    // local côté SDK).
    try {
      await auth.signOut()
    } catch {
      // ignore — l'Auth user est probablement déjà supprimé serveur-side.
    }
    if (!result.authDeleted) {
      // Cas exotique : Firestore est cohérent mais Auth ne l'est pas. On
      // le signale dans l'URL pour que la landing puisse afficher un message
      // d'avertissement si besoin (à brancher plus tard).
      await router.replace({ name: 'landing', query: { account_deleted: 'partial' } })
    } else {
      await router.replace({ name: 'landing', query: { account_deleted: '1' } })
    }
  } catch (err) {
    const code = err instanceof FirebaseError ? err.code : 'unknown'
    console.error(`deleteMyAccount failed [${code}]`, err)
    // Décode le `message` HttpsError (la callable renvoie un message FR).
    deleteError.value =
      err instanceof Error
        ? err.message
        : 'Échec de la suppression. Réessayez plus tard.'
  } finally {
    deleting.value = false
  }
}

// =============================================================================
// Mount
// =============================================================================

const dateFmt = new Intl.DateTimeFormat('fr-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatBirthDate(member: Member | null): string {
  if (!member?.birthDate) return '—'
  return dateFmt.format(new Date(member.birthDate.seconds * 1000))
}

onMounted(async () => {
  fillUserForm()
  // Load dependents + linked member en parallèle. Les dues sont déjà chargés
  // au mount de Home, mais on relance ici au cas où le user atterrirait
  // directement sur /account (deep-link).
  await Promise.all([
    loadLinkedMember(),
    loadDependents(),
    dues.loadMyDues(),
  ])
})

function onBack(): void {
  void router.push({ name: 'home' })
}
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <button
        type="button"
        class="header__back"
        aria-label="Retour"
        @click="onBack"
      >
        <ArrowLeft :size="18" />
      </button>
      <div class="header__id">
        <div class="header__name">Mon compte</div>
        <div class="header__role">Préférences et données personnelles</div>
      </div>
    </div>

    <div class="m-content account__content">
      <!-- =================================================================
           Section 1 — Mes informations (user doc)
           ================================================================= -->
      <h2 class="account__section-title">
        Mes informations
      </h2>
      <p class="account__section-sub">
        Vos coordonnées personnelles, utilisées par l'administration du club pour vous contacter.
      </p>

      <form
        class="account__form"
        @submit.prevent="onSaveUser"
      >
        <div class="card account__card">
          <div>
            <label for="acc-displayName" class="label">Nom complet</label>
            <div class="input-wrap">
              <UserIcon class="input-icon" />
              <input
                id="acc-displayName"
                v-model="displayName"
                class="input with-icon-left"
                autocomplete="name"
                :disabled="savingUser"
                required
              />
            </div>
          </div>

          <div>
            <label for="acc-email" class="label account__label-row">
              <span>Email</span>
              <span
                v-if="emailVerified"
                class="pill pill-emerald"
              >
                <Check :size="12" /> vérifié
              </span>
            </label>
            <div class="input-wrap">
              <Mail class="input-icon" />
              <input
                id="acc-email"
                v-model="email"
                class="input with-icon-left"
                type="email"
                autocomplete="email"
                :readonly="emailVerified"
                :disabled="savingUser"
                required
              />
            </div>
            <p
              v-if="emailVerified"
              class="helper"
            >
              L'email du compte ne peut pas être modifié. Pour le changer, contactez le club.
            </p>
          </div>

          <div>
            <label for="acc-phone" class="label">Téléphone</label>
            <input
              id="acc-phone"
              v-model="phone"
              class="input"
              type="tel"
              autocomplete="tel"
              :disabled="savingUser"
              required
            />
          </div>
        </div>

        <div class="account__subsection-label">
          ADRESSE
        </div>

        <div class="card account__card">
          <div class="account__grid-3">
            <div style="grid-column: span 2;">
              <label for="acc-street" class="label">Rue</label>
              <input
                id="acc-street"
                v-model="street"
                class="input"
                autocomplete="street-address"
                :disabled="savingUser"
                required
              />
            </div>
            <div>
              <label for="acc-num" class="label">N°</label>
              <input
                id="acc-num"
                v-model="streetNumber"
                class="input"
                :disabled="savingUser"
                required
              />
            </div>
          </div>

          <div class="account__grid-3">
            <div>
              <label for="acc-zip" class="label">NPA</label>
              <input
                id="acc-zip"
                v-model="zip"
                class="input"
                autocomplete="postal-code"
                :disabled="savingUser"
                required
              />
            </div>
            <div style="grid-column: span 2;">
              <label for="acc-city" class="label">Ville</label>
              <input
                id="acc-city"
                v-model="city"
                class="input"
                autocomplete="address-level2"
                :disabled="savingUser"
                required
              />
            </div>
          </div>

          <div>
            <label for="acc-country" class="label">Pays</label>
            <div class="input-wrap">
              <Globe class="input-icon" />
              <select
                id="acc-country"
                v-model="country"
                class="input with-icon-left account__select"
                :disabled="savingUser"
              >
                <option
                  v-for="opt in COUNTRIES"
                  :key="opt.code"
                  :value="opt.code"
                >
                  {{ opt.name }}
                </option>
              </select>
              <ChevronDown class="account__select-chevron" />
            </div>
          </div>
        </div>

        <p
          v-if="userFormError"
          class="helper-error account__error"
        >
          <AlertCircle :size="14" /> {{ userFormError }}
        </p>
        <p
          v-if="userFormSuccess"
          class="account__success"
        >
          <Check :size="14" /> Modifications enregistrées.
        </p>

        <button
          type="submit"
          class="btn btn-primary account__save-btn"
          :disabled="savingUser"
        >
          <Save :size="14" /> Enregistrer mes modifications
        </button>
      </form>

      <!-- =================================================================
           Section 2 — Mon profil joueur (linked member)
           ================================================================= -->
      <template v-if="auth.userDoc?.memberId">
        <h2 class="account__section-title account__section-title--spaced">
          Mon profil joueur
        </h2>
        <p class="account__section-sub">
          Les informations sportives saisies lors de votre inscription au club.
        </p>

        <div
          v-if="loadingLinked && !linkedMember"
          class="card account__card"
        >
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>

        <template v-else-if="linkedMember">
          <div class="card account__card account__card--readonly">
            <div class="account__readonly-grid">
              <div>
                <div class="account__readonly-label">Prénom</div>
                <div class="account__readonly-value">{{ linkedMember.firstName || '—' }}</div>
              </div>
              <div>
                <div class="account__readonly-label">Nom</div>
                <div class="account__readonly-value">{{ linkedMember.lastName || '—' }}</div>
              </div>
            </div>
            <div class="account__readonly-grid">
              <div>
                <div class="account__readonly-label">Date de naissance</div>
                <div class="account__readonly-value">{{ formatBirthDate(linkedMember) }}</div>
              </div>
              <div>
                <div class="account__readonly-label">N° AVS</div>
                <div class="account__readonly-value account__readonly-value--mono">
                  {{ linkedMember.avs || '—' }}
                </div>
              </div>
            </div>
            <div>
              <div class="account__readonly-label">N° de licence</div>
              <div class="account__readonly-value account__readonly-value--mono">
                {{ linkedMember.licenseNumber || '—' }}
              </div>
            </div>
            <p class="account__readonly-helper">
              <Lock :size="12" />
              Pour modifier ces informations, contactez le club.
            </p>
          </div>

          <div class="account__subsection-label">
            CONTACT JOUEUR (PRIVÉ)
          </div>

          <form
            class="card account__card"
            @submit.prevent="onSaveLinkedContact"
          >
            <p class="account__hint">
              Ces coordonnées peuvent différer de votre compte (ex. téléphone direct du joueur).
            </p>
            <div>
              <label for="acc-mc-email" class="label">Email</label>
              <div class="input-wrap">
                <Mail class="input-icon" />
                <input
                  id="acc-mc-email"
                  v-model="linkedContactEmail"
                  class="input with-icon-left"
                  type="email"
                  :disabled="savingLinkedContact"
                  required
                />
              </div>
            </div>
            <div>
              <label for="acc-mc-phone" class="label">Téléphone</label>
              <input
                id="acc-mc-phone"
                v-model="linkedContactPhone"
                class="input"
                type="tel"
                :disabled="savingLinkedContact"
                required
              />
            </div>

            <p
              v-if="linkedContactError"
              class="helper-error account__error"
            >
              <AlertCircle :size="14" /> {{ linkedContactError }}
            </p>
            <p
              v-if="linkedContactSuccess"
              class="account__success"
            >
              <Check :size="14" /> Contact joueur enregistré.
            </p>

            <button
              type="submit"
              class="btn btn-secondary account__save-btn"
              :disabled="savingLinkedContact"
            >
              <Save :size="14" /> Enregistrer le contact joueur
            </button>
          </form>
        </template>
      </template>

      <!-- =================================================================
           Section 3 — Mes enfants (dependents)
           ================================================================= -->
      <template v-if="loadingDependents || dependents.length > 0">
        <h2 class="account__section-title account__section-title--spaced">
          Mes enfants
        </h2>
        <p class="account__section-sub">
          Les joueurs pour lesquels vous êtes tuteur légal côté club.
        </p>

        <div
          v-if="loadingDependents"
          class="card account__card"
        >
          <div class="sk h-4 w-2/3 mb-2" />
          <div class="sk h-3 w-1/2" />
        </div>

        <div
          v-for="dep in dependents"
          :key="dep.id"
          class="card account__dep-card"
        >
          <div class="avatar account__dep-avatar">
            {{ ((dep.firstName?.charAt(0) ?? '') + (dep.lastName?.charAt(0) ?? '')).toUpperCase() || '?' }}
          </div>
          <div class="account__dep-body">
            <div class="account__dep-name">
              {{ dep.firstName }} {{ dep.lastName }}
            </div>
            <div class="account__dep-meta">
              Né(e) le {{ formatBirthDate(dep) }}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm account__unlink-btn"
            :disabled="unlinkingId === dep.id"
            @click="onUnlinkDependent(dep)"
          >
            <UserMinus :size="14" /> Délier
          </button>
        </div>
      </template>

      <!-- =================================================================
           Section 4 — Zone dangereuse
           ================================================================= -->
      <h2 class="account__section-title account__section-title--spaced">
        Zone dangereuse
      </h2>
      <div class="card account__danger-card">
        <div class="account__danger-head">
          <AlertTriangle :size="16" class="account__danger-icon" />
          <div>
            <div class="account__danger-title">
              Supprimer définitivement mon compte
            </div>
            <p class="account__danger-desc">
              Cette action supprime votre compte de connexion, votre profil joueur si vous en avez un,
              et tous vos brouillons d'inscription. Vos cotisations payées passées sont préservées
              dans la comptabilité du club. <strong>Action irréversible.</strong>
            </p>
          </div>
        </div>

        <ul
          v-if="deleteBlockers.length > 0"
          class="account__blockers"
        >
          <li
            v-for="(b, i) in deleteBlockers"
            :key="i"
          >
            {{ b }}
          </li>
        </ul>

        <button
          type="button"
          class="btn btn-danger account__delete-btn"
          :disabled="!canAttemptDelete"
          @click="openDeleteDialog"
        >
          <Trash2 :size="14" /> Supprimer mon compte
        </button>
      </div>
    </div>

    <!-- =====================================================================
         Modal — confirmation de suppression
         ===================================================================== -->
    <div
      v-if="showDeleteDialog"
      class="account__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-delete-title"
      @click.self="closeDeleteDialog"
    >
      <div class="account__modal">
        <div class="account__modal-head">
          <AlertTriangle :size="18" class="account__modal-icon" />
          <h3 id="account-delete-title" class="account__modal-title">
            Supprimer définitivement votre compte ?
          </h3>
        </div>
        <p class="account__modal-body">
          Vous êtes sur le point de supprimer définitivement votre compte, vos données personnelles,
          et votre profil joueur si vous en avez un. Vous serez déconnecté(e) immédiatement.
        </p>
        <p class="account__modal-body">
          Pour confirmer, tapez exactement <strong>SUPPRIMER</strong> ci-dessous :
        </p>
        <input
          v-model="deleteConfirmText"
          type="text"
          class="input account__modal-input"
          :disabled="deleting"
          placeholder="SUPPRIMER"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
        />
        <p
          v-if="deleteError"
          class="helper-error account__error"
        >
          <AlertCircle :size="14" /> {{ deleteError }}
        </p>
        <div class="account__modal-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="deleting"
            @click="closeDeleteDialog"
          >
            Annuler
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="deleting || deleteConfirmText.trim() !== 'SUPPRIMER'"
            @click="onConfirmDelete"
          >
            <Trash2 :size="14" />
            {{ deleting ? 'Suppression…' : 'Supprimer définitivement' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---------------- header ---------------- */
.header__back {
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #334155;
  cursor: pointer;
  margin-right: 6px;
}
.header__back:hover {
  background: #f8fafc;
}
.header__id {
  line-height: 1.2;
}
.header__name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.header__role {
  font-size: 10.5px;
  color: #64748b;
}

/* ---------------- sections ---------------- */
.account__content {
  padding-bottom: 80px;
}
.account__section-title {
  font-size: 18px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.01em;
}
.account__section-title--spaced {
  margin-top: 32px;
}
.account__section-sub {
  font-size: 12.5px;
  color: #64748b;
  margin: 4px 0 14px 0;
  line-height: 1.5;
}

.account__subsection-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.08em;
  margin: 18px 0 8px 0;
}

/* ---------------- form ---------------- */
.account__form {
  display: flex;
  flex-direction: column;
}
.account__card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.account__label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.account__grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.account__select {
  appearance: none;
  background-image: none;
  padding-right: 36px;
}
.account__select-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
  width: 14px;
  height: 14px;
}
.account__error {
  margin: 12px 0 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff1f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.account__success {
  margin: 12px 0 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
}
.account__save-btn {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* ---------------- linked member readonly ---------------- */
.account__card--readonly {
  background: #f8fafc;
  border-color: #e2e8f0;
}
.account__readonly-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.account__readonly-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.account__readonly-value {
  font-size: 13.5px;
  color: #0f172a;
  font-weight: 500;
  margin-top: 2px;
}
.account__readonly-value--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
}
.account__readonly-helper {
  margin: 0;
  font-size: 11.5px;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.account__hint {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}

/* ---------------- dependents ---------------- */
.account__dep-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
}
.account__dep-avatar {
  background: #e0e7ff;
  color: #3730a3;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}
.account__dep-body {
  flex: 1;
  min-width: 0;
}
.account__dep-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.account__dep-meta {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 1px;
}
.account__unlink-btn {
  color: #be123c;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.account__unlink-btn:hover:not(:disabled) {
  background: #fff1f2;
}

/* ---------------- danger zone ---------------- */
.account__danger-card {
  border-color: #fecaca;
  background: linear-gradient(180deg, #fff1f2 0%, #ffffff 80%);
  padding: 16px;
}
.account__danger-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.account__danger-icon {
  color: #be123c;
  flex: none;
  margin-top: 2px;
}
.account__danger-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #7f1d1d;
}
.account__danger-desc {
  margin: 4px 0 0 0;
  font-size: 12.5px;
  color: #475569;
  line-height: 1.6;
}
.account__blockers {
  margin: 12px 0 0 0;
  padding: 10px 12px 10px 24px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  color: #78350f;
  font-size: 12px;
  line-height: 1.5;
}
.account__blockers li {
  margin: 0;
}
.account__blockers li + li {
  margin-top: 4px;
}
.account__delete-btn {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* ---------------- modal ---------------- */
.account__modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 16px;
}
.account__modal {
  background: white;
  border-radius: 14px;
  width: 100%;
  max-width: 420px;
  padding: 20px;
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.18);
}
.account__modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.account__modal-icon {
  color: #be123c;
}
.account__modal-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.01em;
}
.account__modal-body {
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
  margin: 12px 0 0 0;
}
.account__modal-input {
  margin-top: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.04em;
}
.account__modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 18px;
  justify-content: flex-end;
}

/* ---------------- skeletons ---------------- */
.h-3 {
  height: 12px;
}
.h-4 {
  height: 16px;
}
.w-2\/3 {
  width: 66.6667%;
}
.w-1\/2 {
  width: 50%;
}
.mb-2 {
  margin-bottom: 8px;
}
</style>
