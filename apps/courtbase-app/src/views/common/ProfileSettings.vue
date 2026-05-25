<script setup lang="ts">
/**
 * C5 — Profil utilisateur.
 *
 * Vue companion (mobile-first + desktop >=1024px) qui affiche les infos
 * perso du user connecté, ses roles, le membre lie (si applicable), les
 * preferences notifications et le bouton de deconnexion.
 *
 * Sources de donnees :
 *  - `useAuthStore()` : Firebase Auth REEL pour identite (uid, email,
 *    displayName, roles via userDoc).
 *  - `useMyProfileStore()` : Firestore REEL pour le linked member
 *    (`/members/{id}`), son contact prive (`/members/{id}/private/contact`)
 *    et ses equipes (`listTeamsForMember`).
 *  - `auth.officialLevel` : encore fallback mock pour l'instant (le
 *    champ n'est pas projete dans le member Firestore minimaliste de la
 *    coach app — voir TODO).
 *
 * Edition du contact prive (`/members/{id}/private/contact`) : write client
 * direct via `myProfile.saveContact()` — autorise par les rules pour
 * `isLinkedMember(memberId)`. Sinon dégradation UI (helper text + bouton
 * désactivé).
 *
 * Notifications push : toggle local-only — l'enregistrement FCM web sera
 * branché en Phase 5 (cf. docs/courtbase-app.md). Désactivé visuellement
 * tant que non câblé pour éviter de laisser croire qu'il est fonctionnel.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Save,
  Send,
} from 'lucide-vue-next'
import ToggleSwitch from 'primevue/toggleswitch'

import CbAvatar from '@/components/ui/CbAvatar.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbPageHead from '@/components/ui/CbPageHead.vue'
import CbPill from '@/components/ui/CbPill.vue'
import { useShellNav } from '@/composables/useShellNav'
import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'
import { useMyProfileStore } from '@/stores/myProfile'
import type { AppRole } from '@/types/roles'

const router = useRouter()
const auth = useAuthStore()
const myProfile = useMyProfileStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

// ---------------------------------------------------------------
// Identite : 100% Firebase Auth via useAuthStore (uid, displayName, email)
// ---------------------------------------------------------------

const displayName = computed(() => auth.displayName)
const email = computed(() => auth.email)

/**
 * Telephone et adresse du USER (pas du member) — viennent du userDoc
 * `/users/{uid}` quand ils sont posés. Adresse est un objet structure cote
 * userDoc (cf. `users.repo.ts`) — on serialise en string pour l'affichage.
 */
const userPhone = computed(() => {
  const p = auth.userDoc?.phone
  if (typeof p === 'string' && p.length > 0) return p
  return ''
})

const userAddress = computed(() => {
  const a = auth.userDoc?.address as
    | {
        street?: string | null
        zip?: string | null
        city?: string | null
        country?: string | null
      }
    | undefined
    | null
  if (!a) return ''
  const street = (a.street ?? '').trim()
  const zip = (a.zip ?? '').trim()
  const city = (a.city ?? '').trim()
  const country = (a.country ?? '').trim()
  // "Rue du Lac 12, 1700 Fribourg, Suisse"
  const left = street
  const middle = [zip, city].filter(Boolean).join(' ')
  const right = country
  return [left, middle, right].filter((s) => s.length > 0).join(', ')
})

const roles = computed<AppRole[]>(() => auth.roles)

// ---------------------------------------------------------------
// Member lie : 100% Firestore via useMyProfileStore (load au mount)
// ---------------------------------------------------------------

const linkedMember = computed(() => myProfile.member)
const linkedMemberFullName = computed(() => myProfile.fullName)
const linkedMemberTeamsLabel = computed(() => myProfile.teamsLabel)
const loadingMember = computed(() => myProfile.loading)

/**
 * Le member Firestore minimaliste de la coach app n'expose pas
 * `officialLicense.level` consistant (le champ est lu mais le mock-only
 * fallback de useAuthStore reste utilise tant qu'un seed/migration n'a
 * pas peuple). On garde donc ici `auth.officialLevel` qui pioche dans
 * `MOCK_SESSION` jusqu'a la phase 2.
 *
 * TODO Phase 2 : remplacer par `linkedMember.value?.officialLicense?.level`
 * une fois le champ peuplé en prod.
 */
const officialLicenseLabel = computed(() => {
  const lvl = auth.officialLevel
  if (lvl == null) return null
  return `Officiel niveau ${lvl} actif`
})

function roleLabel(role: AppRole): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'coach':
      return 'Coach'
    case 'official': {
      const lvl = auth.officialLevel
      return lvl != null ? `Officiel niveau ${lvl}` : 'Officiel'
    }
    case 'player':
      return 'Joueur'
  }
}

// ---------------------------------------------------------------
// Edition du contact prive du member (`/members/{id}/private/contact`)
// ---------------------------------------------------------------

const contactEditMode = ref(false)
const contactEmail = ref('')
const contactPhone = ref('')
const contactSavedFlash = ref(false)

/** Pre-remplit le form quand le contact arrive depuis le store. */
watch(
  () => myProfile.contact,
  (c) => {
    if (!c) {
      contactEmail.value = ''
      contactPhone.value = ''
      return
    }
    contactEmail.value = c.email ?? ''
    contactPhone.value = c.phone ?? ''
  },
  { immediate: true },
)

const canEditContact = computed(() => {
  // Le user est le linked member <=> userDoc.memberId est posé. Sans ça, la
  // rule refusera le write.
  return Boolean(auth.userDoc?.memberId)
})

function onEditContact(): void {
  contactEditMode.value = true
  contactSavedFlash.value = false
}

function onCancelEditContact(): void {
  contactEditMode.value = false
  // Restore depuis le store.
  const c = myProfile.contact
  contactEmail.value = c?.email ?? ''
  contactPhone.value = c?.phone ?? ''
}

async function onSaveContact(): Promise<void> {
  contactSavedFlash.value = false
  const ok = await myProfile.saveContact({
    email: contactEmail.value.trim(),
    phone: contactPhone.value.trim(),
  })
  if (ok) {
    contactEditMode.value = false
    contactSavedFlash.value = true
    window.setTimeout(() => {
      contactSavedFlash.value = false
    }, 2500)
  }
}

// ---------------------------------------------------------------
// Notifications push — local-only (Phase 5 wiring FCM à venir)
// ---------------------------------------------------------------

/**
 * Toggle de preference locale (pas de persistance). L'enregistrement FCM
 * cote serveur (`/users/{uid}/fcmTokens/{tokenId}`) est out-of-scope tant
 * que le service worker FCM n'est pas branche (Phase 5, cf.
 * docs/courtbase-app.md). On expose le toggle en disabled + helper text
 * pour ne pas laisser croire que c'est cable.
 */
const pushEnabled = ref(true)
const pushAvailable = false

function onTestNotification(): void {
  // Phase 5 wiring TBD — declenchera une notif test via FCM cote serveur.
  // No-op silencieux tant que c'est désactivé.
}

// ---------------------------------------------------------------
// Sign-out (deja Firebase reel via auth.signOut())
// ---------------------------------------------------------------

async function onSignOut(): Promise<void> {
  try {
    await auth.signOut()
    // Reset du store profil au passage (sinon le prochain user verrait
    // brievement le profil precedent en cache).
    myProfile.reset()
  } catch (err) {
    console.error('[ProfileSettings] signOut failed', err)
  }
  await router.push({ name: 'sign-in' })
}

// ---------------------------------------------------------------
// Sub-role label détaillé pour la card user desktop ("Coach · Officiel niveau 2")
// — distinct de `primaryRoleLabel` qui affiche le rôle prioritaire seul
// dans l'avatar de la sidebar.
// ---------------------------------------------------------------

const userRoleLabel = computed(() => roles.value.map(roleLabel).join(' · '))

function onBack(): void {
  if (window.history.length > 1) router.back()
  else router.push({ name: 'home' })
}

function onEditProfile(): void {
  // Reuse ProfileSetup en mode "edit" pour la prochaine itération.
  router.push({ name: 'profile-setup' })
}

// ---------------------------------------------------------------
// Mount : charge le profil reel
// ---------------------------------------------------------------

onMounted(async () => {
  await myProfile.load()
})
</script>

<template>
  <!-- Mobile shell -->
  <CbMobileShell
    v-if="!isDesktop"
    title="Mon profil"
    club="BCA"
    show-back
    :tabs="tabs"
    @back="onBack"
  >
    <div class="cb-page profile-page">
      <!-- Card user -->
      <article class="cb-card profile-user-card">
        <div class="profile-user-head">
          <CbAvatar :name="displayName" size="lg" tone="emerald" />
          <div class="profile-user-meta">
            <div class="cb-h2 profile-name">{{ displayName }}</div>
            <button
              type="button"
              class="cb-btn ghost sm profile-edit-btn"
              @click="onEditProfile"
            >
              Modifier
            </button>
          </div>
        </div>

        <div class="cb-div profile-divider" />

        <ul class="profile-contact">
          <li>
            <Mail :size="16" />
            <span class="profile-contact-value">{{ email || '—' }}</span>
          </li>
          <li>
            <Phone :size="16" />
            <span class="profile-contact-value">{{ userPhone || '—' }}</span>
          </li>
          <li>
            <MapPin :size="16" />
            <span class="profile-contact-value">{{ userAddress || '—' }}</span>
          </li>
        </ul>
      </article>

      <!-- Roles -->
      <div class="cb-section-label profile-section-label">Rôles</div>
      <div class="profile-roles">
        <CbPill v-for="r in roles" :key="r" tone="violet">
          {{ roleLabel(r) }}
        </CbPill>
      </div>

      <!-- Membre lié (loading + content) -->
      <template v-if="loadingMember && !linkedMember">
        <div class="cb-section-label profile-section-label">Membre lié</div>
        <article class="cb-card profile-linked-card">
          <div class="profile-linked-loading">
            <Loader2 :size="14" class="profile-spin" />
            <span>Chargement du profil joueur…</span>
          </div>
        </article>
      </template>

      <template v-else-if="linkedMember">
        <div class="cb-section-label profile-section-label">Membre lié</div>
        <article class="cb-card profile-linked-card">
          <div class="profile-linked-head">
            <CbAvatar
              :name="linkedMemberFullName"
              tone="emerald"
            />
            <div class="profile-linked-meta">
              <div class="profile-linked-name">{{ linkedMemberFullName }}</div>
              <div class="cb-sub profile-linked-teams">{{ linkedMemberTeamsLabel }}</div>
            </div>
            <CbPill tone="emerald" dot>Actif</CbPill>
          </div>

          <div v-if="officialLicenseLabel" class="profile-linked-license">
            <CbPill tone="emerald" dot>{{ officialLicenseLabel }}</CbPill>
          </div>
          <div v-else class="profile-linked-license">
            <CbPill tone="slate">Pas de licence officiel</CbPill>
          </div>

          <p class="cb-sub profile-linked-hint">
            Ces informations sont gérées par l'administration du club.
            Contactez votre admin pour toute modification.
          </p>
        </article>

        <!-- Contact privé du joueur — éditable si canEditContact -->
        <div class="cb-section-label profile-section-label">
          Contact joueur (privé)
        </div>
        <article class="cb-card profile-contact-card">
          <p class="cb-sub profile-contact-hint">
            Ces coordonnées peuvent différer de celles de votre compte (ex. téléphone direct du joueur).
          </p>

          <template v-if="!contactEditMode">
            <ul class="profile-contact profile-contact-readonly">
              <li>
                <Mail :size="16" />
                <span class="profile-contact-value">
                  {{ (myProfile.contact?.email) || '—' }}
                </span>
              </li>
              <li>
                <Phone :size="16" />
                <span class="profile-contact-value">
                  {{ (myProfile.contact?.phone) || '—' }}
                </span>
              </li>
            </ul>
            <p v-if="contactSavedFlash" class="profile-flash-success">
              <Check :size="14" /> Contact enregistré.
            </p>
            <button
              v-if="canEditContact && !myProfile.contactWriteDenied"
              type="button"
              class="cb-btn outline sm profile-contact-edit-btn"
              :disabled="loadingMember"
              @click="onEditContact"
            >
              Modifier
            </button>
            <p
              v-else-if="!canEditContact"
              class="cb-sub profile-contact-locked"
            >
              Cette section ne peut être modifiée que par le joueur lié à ce compte.
            </p>
          </template>

          <form
            v-else
            class="profile-contact-form"
            @submit.prevent="onSaveContact"
          >
            <div class="profile-contact-field">
              <label class="cb-section-label" for="contact-email">Email</label>
              <input
                id="contact-email"
                v-model="contactEmail"
                type="email"
                class="cb-input"
                :disabled="myProfile.savingContact"
                placeholder="exemple@email.com"
                autocomplete="email"
              />
            </div>
            <div class="profile-contact-field">
              <label class="cb-section-label" for="contact-phone">Téléphone</label>
              <input
                id="contact-phone"
                v-model="contactPhone"
                type="tel"
                class="cb-input"
                :disabled="myProfile.savingContact"
                placeholder="+41 78 123 45 67"
                autocomplete="tel"
              />
            </div>

            <p
              v-if="myProfile.saveError"
              class="profile-flash-error"
            >
              <AlertCircle :size="14" />
              <span>{{ myProfile.saveError }}</span>
            </p>

            <div class="profile-contact-actions">
              <button
                type="button"
                class="cb-btn ghost sm"
                :disabled="myProfile.savingContact"
                @click="onCancelEditContact"
              >
                Annuler
              </button>
              <button
                type="submit"
                class="cb-btn primary sm"
                :disabled="myProfile.savingContact"
              >
                <Loader2
                  v-if="myProfile.savingContact"
                  :size="14"
                  class="profile-spin"
                />
                <Save v-else :size="14" />
                <span>Enregistrer</span>
              </button>
            </div>
          </form>
        </article>
      </template>

      <!-- Bandeau erreur de chargement profile (rare) -->
      <p
        v-if="myProfile.loadError"
        class="profile-flash-error profile-load-error"
      >
        <AlertCircle :size="14" />
        <span>{{ myProfile.loadError }}</span>
      </p>

      <!-- Préférences notifications -->
      <div class="cb-section-label profile-section-label">
        Préférences notifications
      </div>
      <div class="cb-card profile-prefs-card">
        <div class="profile-pref-row">
          <div class="profile-pref-text">
            <div class="profile-pref-title">Notifications push</div>
            <div class="cb-sub">
              Recevez les rappels match et les urgences.
              <template v-if="!pushAvailable">
                <br />
                <em>Bientôt disponible.</em>
              </template>
            </div>
          </div>
          <ToggleSwitch
            v-model="pushEnabled"
            :disabled="!pushAvailable"
            aria-label="Activer les notifications push"
          />
        </div>

        <div class="cb-div" />

        <button
          type="button"
          class="profile-test-btn"
          :disabled="!pushAvailable"
          @click="onTestNotification"
        >
          <Send :size="16" />
          <span>Tester une notification</span>
          <ChevronRight :size="16" class="profile-test-chev" />
        </button>
      </div>

      <!-- Sign-out -->
      <button type="button" class="cb-btn ghost block profile-signout" @click="onSignOut">
        <LogOut :size="16" />
        <span>Se déconnecter</span>
      </button>
    </div>
  </CbMobileShell>

  <!-- Desktop shell -->
  <CbDesktopShell
    v-else
    :items="nav"
    brand-name="BC Aigles"
    brand-sub="Saison 2025/26"
    club-initials="BCA"
    :user-name="displayName"
    :user-role="primaryRoleLabel"
  >
    <CbPageHead title="Mon profil" subtitle="Vos informations personnelles et vos préférences." />

    <div class="profile-desktop">
      <div class="profile-desktop-grid">
        <!-- Colonne 1 : card user -->
        <article class="cb-card profile-user-card desktop">
          <div class="profile-user-head desktop">
            <CbAvatar :name="displayName" size="lg" tone="emerald" />
            <div class="profile-user-meta">
              <div class="cb-h2 profile-name">{{ displayName }}</div>
              <div class="cb-sub">{{ userRoleLabel }}</div>
            </div>
          </div>

          <div class="cb-div profile-divider" />

          <ul class="profile-contact">
            <li>
              <Mail :size="16" />
              <span class="profile-contact-value">{{ email || '—' }}</span>
            </li>
            <li>
              <Phone :size="16" />
              <span class="profile-contact-value">{{ userPhone || '—' }}</span>
            </li>
            <li>
              <MapPin :size="16" />
              <span class="profile-contact-value">{{ userAddress || '—' }}</span>
            </li>
          </ul>

          <button
            type="button"
            class="cb-btn outline block profile-edit-btn desktop"
            @click="onEditProfile"
          >
            Modifier mes infos
          </button>
        </article>

        <!-- Colonne 2 : sections paramètres -->
        <div class="profile-desktop-right">
          <!-- Rôles -->
          <section>
            <div class="cb-section-label profile-section-label desktop">Rôles</div>
            <div class="profile-roles">
              <CbPill v-for="r in roles" :key="r" tone="violet">
                {{ roleLabel(r) }}
              </CbPill>
            </div>
          </section>

          <!-- Membre lié -->
          <section v-if="loadingMember && !linkedMember">
            <div class="cb-section-label profile-section-label desktop">Membre lié</div>
            <article class="cb-card profile-linked-card">
              <div class="profile-linked-loading">
                <Loader2 :size="14" class="profile-spin" />
                <span>Chargement du profil joueur…</span>
              </div>
            </article>
          </section>

          <section v-else-if="linkedMember">
            <div class="cb-section-label profile-section-label desktop">Membre lié</div>
            <article class="cb-card profile-linked-card">
              <div class="profile-linked-head">
                <CbAvatar
                  :name="linkedMemberFullName"
                  tone="emerald"
                />
                <div class="profile-linked-meta">
                  <div class="profile-linked-name">{{ linkedMemberFullName }}</div>
                  <div class="cb-sub profile-linked-teams">{{ linkedMemberTeamsLabel }}</div>
                </div>
                <CbPill tone="emerald" dot>Actif</CbPill>
              </div>

              <div v-if="officialLicenseLabel" class="profile-linked-license">
                <CbPill tone="emerald" dot>{{ officialLicenseLabel }}</CbPill>
              </div>
              <div v-else class="profile-linked-license">
                <CbPill tone="slate">Pas de licence officiel</CbPill>
              </div>

              <p class="cb-sub profile-linked-hint">
                Ces informations sont gérées par l'administration du club.
                Contactez votre admin pour toute modification.
              </p>
            </article>
          </section>

          <!-- Contact privé éditable (desktop) -->
          <section v-if="linkedMember">
            <div class="cb-section-label profile-section-label desktop">
              Contact joueur (privé)
            </div>
            <article class="cb-card profile-contact-card">
              <p class="cb-sub profile-contact-hint">
                Ces coordonnées peuvent différer de celles de votre compte (ex. téléphone direct du joueur).
              </p>

              <template v-if="!contactEditMode">
                <ul class="profile-contact profile-contact-readonly">
                  <li>
                    <Mail :size="16" />
                    <span class="profile-contact-value">
                      {{ (myProfile.contact?.email) || '—' }}
                    </span>
                  </li>
                  <li>
                    <Phone :size="16" />
                    <span class="profile-contact-value">
                      {{ (myProfile.contact?.phone) || '—' }}
                    </span>
                  </li>
                </ul>
                <p v-if="contactSavedFlash" class="profile-flash-success">
                  <Check :size="14" /> Contact enregistré.
                </p>
                <button
                  v-if="canEditContact && !myProfile.contactWriteDenied"
                  type="button"
                  class="cb-btn outline sm profile-contact-edit-btn"
                  :disabled="loadingMember"
                  @click="onEditContact"
                >
                  Modifier
                </button>
                <p
                  v-else-if="!canEditContact"
                  class="cb-sub profile-contact-locked"
                >
                  Cette section ne peut être modifiée que par le joueur lié à ce compte.
                </p>
              </template>

              <form
                v-else
                class="profile-contact-form"
                @submit.prevent="onSaveContact"
              >
                <div class="profile-contact-field">
                  <label class="cb-section-label" for="contact-email-d">Email</label>
                  <input
                    id="contact-email-d"
                    v-model="contactEmail"
                    type="email"
                    class="cb-input"
                    :disabled="myProfile.savingContact"
                    placeholder="exemple@email.com"
                    autocomplete="email"
                  />
                </div>
                <div class="profile-contact-field">
                  <label class="cb-section-label" for="contact-phone-d">Téléphone</label>
                  <input
                    id="contact-phone-d"
                    v-model="contactPhone"
                    type="tel"
                    class="cb-input"
                    :disabled="myProfile.savingContact"
                    placeholder="+41 78 123 45 67"
                    autocomplete="tel"
                  />
                </div>

                <p
                  v-if="myProfile.saveError"
                  class="profile-flash-error"
                >
                  <AlertCircle :size="14" />
                  <span>{{ myProfile.saveError }}</span>
                </p>

                <div class="profile-contact-actions">
                  <button
                    type="button"
                    class="cb-btn ghost sm"
                    :disabled="myProfile.savingContact"
                    @click="onCancelEditContact"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    class="cb-btn primary sm"
                    :disabled="myProfile.savingContact"
                  >
                    <Loader2
                      v-if="myProfile.savingContact"
                      :size="14"
                      class="profile-spin"
                    />
                    <Save v-else :size="14" />
                    <span>Enregistrer</span>
                  </button>
                </div>
              </form>
            </article>
          </section>

          <!-- Erreur de chargement -->
          <p
            v-if="myProfile.loadError"
            class="profile-flash-error profile-load-error"
          >
            <AlertCircle :size="14" />
            <span>{{ myProfile.loadError }}</span>
          </p>

          <!-- Préférences notifications -->
          <section>
            <div class="cb-section-label profile-section-label desktop">
              Préférences notifications
            </div>
            <div class="cb-card profile-prefs-card">
              <div class="profile-pref-row">
                <div class="profile-pref-text">
                  <div class="profile-pref-title">Notifications push</div>
                  <div class="cb-sub">
                    Recevez les rappels match et les urgences.
                    <template v-if="!pushAvailable">
                      <br />
                      <em>Bientôt disponible.</em>
                    </template>
                  </div>
                </div>
                <ToggleSwitch
                  v-model="pushEnabled"
                  :disabled="!pushAvailable"
                  aria-label="Activer les notifications push"
                />
              </div>

              <div class="cb-div" />

              <button
                type="button"
                class="profile-test-btn"
                :disabled="!pushAvailable"
                @click="onTestNotification"
              >
                <Send :size="16" />
                <span>Tester une notification</span>
                <ChevronRight :size="16" class="profile-test-chev" />
              </button>
            </div>
          </section>

          <!-- Sign-out -->
          <section>
            <button
              type="button"
              class="cb-btn ghost profile-signout desktop"
              @click="onSignOut"
            >
              <LogOut :size="16" />
              <span>Se déconnecter</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  </CbDesktopShell>
</template>

<style scoped>
/* Layout mobile */
.profile-page { gap: 10px; }
.profile-section-label { padding: 14px 0 6px; }

/* Card user */
.profile-user-card { padding: 16px; }
.profile-user-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.profile-user-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.profile-name {
  font-size: 18px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-edit-btn {
  flex-shrink: 0;
  color: var(--emerald-700);
}
.profile-divider {
  margin: 14px 0;
}
.profile-contact {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.profile-contact li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}
.profile-contact li > svg {
  color: var(--text-subtle);
  flex-shrink: 0;
}
.profile-contact-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-contact-readonly {
  margin-bottom: 4px;
}

/* Roles */
.profile-roles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* Card membre lié */
.profile-linked-card {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.profile-linked-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.profile-linked-meta {
  flex: 1;
  min-width: 0;
}
.profile-linked-name {
  font-weight: 600;
  font-size: 14px;
}
.profile-linked-teams {
  margin-top: 2px;
}
.profile-linked-license {
  display: flex;
}
.profile-linked-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.profile-linked-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-subtle);
  font-size: 13px;
}

/* Card contact privé */
.profile-contact-card {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.profile-contact-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.profile-contact-edit-btn {
  align-self: flex-start;
}
.profile-contact-locked {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--text-subtle);
  font-style: italic;
}
.profile-contact-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.profile-contact-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.profile-contact-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

/* Flash messages */
.profile-flash-success {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--emerald-50);
  border: 1px solid var(--emerald-200);
  color: var(--emerald-700);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.profile-flash-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--rose-50);
  border: 1px solid var(--rose-200);
  color: var(--rose-700);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.profile-load-error {
  margin-top: 10px;
}
.profile-spin {
  animation: profile-spin 1s linear infinite;
}
@keyframes profile-spin {
  to { transform: rotate(360deg); }
}

/* Card préférences notifications */
.profile-prefs-card {
  padding: 0;
  overflow: hidden;
}
.profile-pref-row {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.profile-pref-text {
  flex: 1;
  min-width: 0;
}
.profile-pref-title {
  font-weight: 600;
  font-size: 14px;
}
.profile-test-btn {
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--emerald-700);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.profile-test-btn:hover:not(:disabled) {
  background: var(--slate-50);
}
.profile-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: var(--slate-500);
}
.profile-test-btn > span {
  flex: 1;
}
.profile-test-chev {
  color: var(--slate-400);
}

/* Sign-out */
.profile-signout {
  margin-top: 14px;
  color: var(--rose-600);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.profile-signout:hover {
  background: var(--rose-50);
  color: var(--rose-700);
}

/* Desktop layout */
.profile-desktop {
  flex: 1;
  overflow: auto;
  padding: 24px 28px 32px;
  background: var(--bg-muted);
}
.profile-desktop-grid {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 24px;
  align-items: start;
  max-width: 1024px;
}
.profile-desktop-right {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.profile-user-card.desktop {
  padding: 24px;
  position: sticky;
  top: 24px;
}
.profile-user-head.desktop {
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}
.profile-user-head.desktop .profile-user-meta {
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 4px;
  width: 100%;
}
.profile-edit-btn.desktop {
  margin-top: 16px;
}
.profile-section-label.desktop {
  padding: 0 0 8px;
}
.profile-signout.desktop {
  align-self: flex-start;
  padding: 8px 14px;
}

/* Responsive fine-tune */
@media (max-width: 1180px) {
  .profile-desktop-grid {
    grid-template-columns: 1fr;
  }
  .profile-user-card.desktop {
    position: static;
  }
}
</style>
