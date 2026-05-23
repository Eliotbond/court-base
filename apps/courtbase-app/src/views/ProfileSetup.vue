<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import CbBottomBar from '@/components/ui/CbBottomBar.vue'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import { useViewport } from '@/composables/useViewport'
import { logMockAction } from '@/repositories/mock'
import { useAuthStore } from '@/stores/auth'

/**
 * C2 — Profile completion (premier sign-in).
 *
 * Complète `/users/{uid}` avec `displayName`, `phone`, `address` quand
 * le user signed-in arrive sans profil renseigné. Mock-only : on log
 * l'action via `logMockAction` puis on navigue vers `home`. Quand
 * Firebase Auth sera branché, on appellera `setDoc('/users/{uid}', …)`
 * avec un merge et on déclenchera ensuite la même navigation.
 *
 * Pré-remplissage : on lit la session (mock) — `displayName` + `phone`
 * peuvent déjà avoir une valeur. Dans la vraie vie, OAuth Google fournit
 * en général un `displayName` mais rarement un `phone` ou une adresse.
 *
 * Layout :
 * - Mobile : `CbMobileShell hide-header plain-body` + sticky bottom CTA.
 * - Desktop ≥1024px : viewport centré, card 560px avec shadow, CTA
 *   aligné à droite en bas du card (pas de sticky bar).
 */

const router = useRouter()
const auth = useAuthStore()
const { isDesktop } = useViewport()

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Sépare le code pays du numéro pour pouvoir afficher le préfixe
 * "+41" dans l'addon visuel et garder le reste éditable. Mock-only :
 * on n'autorise que CH pour l'instant, donc on strip "+41" si présent.
 */
function stripCountryCode(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (trimmed.startsWith('+41')) return trimmed.slice(3).trim()
  return trimmed
}

function computeInitials(name: string, email: string): string {
  const trimmed = name.trim()
  if (!trimmed) return email.slice(0, 2).toUpperCase()
  const parts = trimmed.split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0) return trimmed.slice(0, 2).toUpperCase()
  if (parts.length === 1) {
    const first = parts[0] ?? ''
    return first.slice(0, 2).toUpperCase()
  }
  const a = parts[0] ?? ''
  const b = parts[parts.length - 1] ?? ''
  return `${a.charAt(0)}${b.charAt(0)}`.toUpperCase()
}

// ─── Form state ───────────────────────────────────────────────────

interface AddressForm {
  street: string
  streetNumber: string
  postalCode: string
  city: string
  country: string
}

interface FormState {
  displayName: string
  phone: string
  address: AddressForm
}

const form = reactive<FormState>({
  // Pré-remplissage depuis la session mock. Si `hasProfile === false`
  // dans un cas réel, seul `displayName` est typiquement présent —
  // on garde ce qu'il y a, l'utilisateur peut tout éditer.
  displayName: auth.session.displayName ?? '',
  phone: stripCountryCode(auth.session.phone ?? ''),
  address: {
    street: '',
    streetNumber: '',
    postalCode: '',
    city: '',
    country: 'CH',
  },
})

const submitted = ref(false)

// ─── Initials avatar (desktop header) ─────────────────────────────

const initials = computed(() =>
  computeInitials(auth.session.displayName ?? '', auth.session.email ?? ''),
)

// ─── Validation ───────────────────────────────────────────────────

const errors = computed<Partial<Record<'displayName' | 'phone', string>>>(() => {
  if (!submitted.value) return {}
  const out: Partial<Record<'displayName' | 'phone', string>> = {}
  if (form.displayName.trim().length === 0) {
    out.displayName = 'Indiquez votre nom complet.'
  }
  if (form.phone.trim().length === 0) {
    out.phone = 'Indiquez un numéro de téléphone.'
  }
  return out
})

// ─── Submit ───────────────────────────────────────────────────────

function onContinue(): void {
  submitted.value = true
  if (form.displayName.trim().length === 0 || form.phone.trim().length === 0) {
    return
  }

  // Compose le payload tel qu'on l'enverra côté Firestore une fois branché.
  const phone = form.phone.trim().length > 0 ? `+41 ${form.phone.trim()}` : ''
  const address = {
    street: form.address.street.trim(),
    streetNumber: form.address.streetNumber.trim(),
    postalCode: form.address.postalCode.trim(),
    city: form.address.city.trim(),
    country: form.address.country,
  }
  logMockAction('c2.profile-complete', {
    displayName: form.displayName.trim(),
    phone,
    address,
  })

  // Navigation : home — le router guard laissera passer puisque
  // `hasProfile` deviendra true côté store quand la vraie API sera
  // branchée. En mock, on s'appuie sur le fait que le placeholder
  // session a déjà `profileCompleted = true`.
  router.push({ name: 'home' })
}
</script>

<template>
  <!-- ────────────────────────────────────────────────────────────
       Desktop ≥1024px : layout centré, card avec shadow.
       ──────────────────────────────────────────────────────────── -->
  <div v-if="isDesktop" class="profile-desktop">
    <header class="profile-desktop__header">
      <div class="profile-desktop__brand">
        <div class="cb-logo">BCA</div>
        <div>
          <div class="profile-desktop__brand-name">BC Aigles</div>
          <div class="cb-sub">Compléter le profil</div>
        </div>
      </div>
      <div class="profile-desktop__user">
        <div class="cb-avatar emerald sm">{{ initials }}</div>
        <div class="profile-desktop__user-email">{{ auth.session.email }}</div>
      </div>
    </header>

    <div class="profile-desktop__scroll">
      <div class="profile-desktop__container">
        <h1 class="cb-h1 profile-desktop__title">Quelques infos pour commencer</h1>
        <p class="cb-sub profile-desktop__sub">
          Ces informations restent privées et ne sont utilisées que par l'administration du club.
        </p>

        <form class="cb-card profile-desktop__card" novalidate @submit.prevent="onContinue">
          <div class="cb-field">
            <label for="ps-name-d">Nom complet</label>
            <input
              id="ps-name-d"
              v-model="form.displayName"
              class="cb-input"
              :class="{ error: !!errors.displayName }"
              type="text"
              autocomplete="name"
              placeholder="Prénom Nom"
            />
            <div v-if="errors.displayName" class="cb-error">{{ errors.displayName }}</div>
          </div>

          <div class="cb-field">
            <label for="ps-phone-d">Téléphone</label>
            <div class="ps-phone">
              <div class="ps-phone__prefix" aria-hidden="true">
                <span class="ps-flag-ch">
                  <span class="ps-flag-cross" />
                </span>
                <span class="ps-phone__code">+41</span>
              </div>
              <input
                id="ps-phone-d"
                v-model="form.phone"
                class="cb-input ps-phone__input"
                :class="{ error: !!errors.phone }"
                type="tel"
                inputmode="tel"
                autocomplete="tel-national"
                placeholder="78 123 45 67"
              />
            </div>
            <div v-if="errors.phone" class="cb-error">{{ errors.phone }}</div>
            <div v-else class="cb-helper">Au format suisse, ex. 078 123 45 67.</div>
          </div>

          <div class="ps-divider" />

          <div class="ps-section-label">Adresse</div>

          <div class="ps-address-grid ps-address-grid--desktop">
            <div class="cb-field ps-col-street">
              <label for="ps-street-d">Rue</label>
              <input
                id="ps-street-d"
                v-model="form.address.street"
                class="cb-input"
                type="text"
                autocomplete="address-line1"
                placeholder="Av. de la Gare"
              />
            </div>
            <div class="cb-field">
              <label for="ps-num-d">N°</label>
              <input
                id="ps-num-d"
                v-model="form.address.streetNumber"
                class="cb-input"
                type="text"
                autocomplete="address-line2"
                placeholder="34"
              />
            </div>
            <div class="cb-field">
              <label for="ps-npa-d">NPA</label>
              <input
                id="ps-npa-d"
                v-model="form.address.postalCode"
                class="cb-input"
                type="text"
                inputmode="numeric"
                autocomplete="postal-code"
                placeholder="1003"
              />
            </div>
            <div class="cb-field">
              <label for="ps-city-d">Ville</label>
              <input
                id="ps-city-d"
                v-model="form.address.city"
                class="cb-input"
                type="text"
                autocomplete="address-level2"
                placeholder="Lausanne"
              />
            </div>
            <div class="cb-field ps-col-country">
              <label for="ps-country-d">Pays</label>
              <select
                id="ps-country-d"
                v-model="form.address.country"
                class="cb-input"
                autocomplete="country"
              >
                <option value="CH">Suisse</option>
                <option value="FR">France</option>
                <option value="DE">Allemagne</option>
                <option value="IT">Italie</option>
                <option value="AT">Autriche</option>
                <option value="other">Autre</option>
              </select>
            </div>
          </div>

          <div class="profile-desktop__actions">
            <button type="submit" class="cb-btn primary lg">Continuer</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- ────────────────────────────────────────────────────────────
       Mobile (default) : shell mobile + sticky bottom CTA.
       ──────────────────────────────────────────────────────────── -->
  <CbMobileShell v-else hide-header plain-body>
    <form class="cb-page ps-mobile" novalidate @submit.prevent="onContinue">
      <div class="ps-mobile__intro">
        <h1 class="cb-h1">Quelques infos pour commencer</h1>
        <p class="cb-sub ps-mobile__sub">
          Ces informations restent privées et ne sont utilisées que par l'administration du club.
        </p>
      </div>

      <div class="cb-field">
        <label for="ps-name">Nom complet</label>
        <input
          id="ps-name"
          v-model="form.displayName"
          class="cb-input"
          :class="{ error: !!errors.displayName }"
          type="text"
          autocomplete="name"
          placeholder="Prénom Nom"
        />
        <div v-if="errors.displayName" class="cb-error">{{ errors.displayName }}</div>
      </div>

      <div class="cb-field">
        <label for="ps-phone">Téléphone</label>
        <div class="ps-phone">
          <div class="ps-phone__prefix" aria-hidden="true">
            <span class="ps-flag-ch">
              <span class="ps-flag-cross" />
            </span>
            <span class="ps-phone__code">+41</span>
          </div>
          <input
            id="ps-phone"
            v-model="form.phone"
            class="cb-input ps-phone__input"
            :class="{ error: !!errors.phone }"
            type="tel"
            inputmode="tel"
            autocomplete="tel-national"
            placeholder="78 123 45 67"
          />
        </div>
        <div v-if="errors.phone" class="cb-error">{{ errors.phone }}</div>
        <div v-else class="cb-helper">Au format suisse, ex. 078 123 45 67.</div>
      </div>

      <div class="ps-section-label">Adresse</div>

      <div class="ps-address-grid ps-address-grid--mobile">
        <div class="cb-field ps-col-street">
          <label for="ps-street">Rue</label>
          <input
            id="ps-street"
            v-model="form.address.street"
            class="cb-input"
            type="text"
            autocomplete="address-line1"
            placeholder="Av. de la Gare"
          />
        </div>
        <div class="cb-field">
          <label for="ps-num">N°</label>
          <input
            id="ps-num"
            v-model="form.address.streetNumber"
            class="cb-input"
            type="text"
            autocomplete="address-line2"
            placeholder="34"
          />
        </div>
        <div class="cb-field">
          <label for="ps-npa">NPA</label>
          <input
            id="ps-npa"
            v-model="form.address.postalCode"
            class="cb-input"
            type="text"
            inputmode="numeric"
            autocomplete="postal-code"
            placeholder="1003"
          />
        </div>
        <div class="cb-field ps-col-city">
          <label for="ps-city">Ville</label>
          <input
            id="ps-city"
            v-model="form.address.city"
            class="cb-input"
            type="text"
            autocomplete="address-level2"
            placeholder="Lausanne"
          />
        </div>
        <div class="cb-field ps-col-country">
          <label for="ps-country">Pays</label>
          <select
            id="ps-country"
            v-model="form.address.country"
            class="cb-input"
            autocomplete="country"
          >
            <option value="CH">Suisse</option>
            <option value="FR">France</option>
            <option value="DE">Allemagne</option>
            <option value="IT">Italie</option>
            <option value="AT">Autriche</option>
            <option value="other">Autre</option>
          </select>
        </div>
      </div>

      <!-- Spacer pour que le sticky CTA ne masque pas la fin du form. -->
      <div class="ps-mobile__spacer" aria-hidden="true" />

      <!-- Submit invisible : permet à Enter de soumettre le form. -->
      <button type="submit" class="ps-hidden-submit" aria-hidden="true" tabindex="-1" />
    </form>

    <CbBottomBar>
      <button type="button" class="cb-btn primary block lg" @click="onContinue">Continuer</button>
    </CbBottomBar>
  </CbMobileShell>
</template>

<style scoped>
/* ─── Mobile ───────────────────────────────────────────────────── */
.ps-mobile {
  padding-top: 24px;
}
.ps-mobile__intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}
.ps-mobile__sub {
  margin-top: 2px;
}
.ps-mobile__spacer {
  /* Hauteur du bottom bar + safe area pour ne pas masquer le dernier champ. */
  height: 16px;
}
.ps-hidden-submit {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  height: 0;
  width: 0;
  border: 0;
  padding: 0;
}

/* ─── Section label "Adresse" ─────────────────────────────────── */
.ps-section-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--slate-700);
  margin-top: 4px;
}

/* ─── Grid adresse ────────────────────────────────────────────── */
.ps-address-grid {
  display: grid;
  gap: 10px;
}
.ps-address-grid--mobile {
  grid-template-columns: 2fr 1fr;
}
.ps-address-grid--mobile .ps-col-street { grid-column: 1 / -1; }
.ps-address-grid--mobile .ps-col-city { grid-column: 1 / -1; }
.ps-address-grid--mobile .ps-col-country { grid-column: 1 / -1; }

.ps-address-grid--desktop {
  grid-template-columns: 3fr 1fr 1fr 2fr;
  gap: 14px;
}
.ps-address-grid--desktop .ps-col-street { grid-column: 1 / span 1; }
.ps-address-grid--desktop .ps-col-country { grid-column: 1 / -1; }

/* ─── Divider du card desktop ─────────────────────────────────── */
.ps-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

/* ─── Téléphone avec préfixe +41 ──────────────────────────────── */
.ps-phone {
  position: relative;
}
.ps-phone__prefix {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  z-index: 1;
}
.ps-phone__code {
  font-size: 13px;
  font-weight: 500;
  color: var(--slate-700);
}
.ps-phone__input {
  padding-left: 72px;
}

/* Drapeau CH (vectoriel CSS, pas d'image externe). */
.ps-flag-ch {
  position: relative;
  display: inline-block;
  width: 20px;
  height: 14px;
  background: #dc2626;
  border-radius: 2px;
}
.ps-flag-cross::before,
.ps-flag-cross::after {
  content: '';
  position: absolute;
  background: #fff;
}
.ps-flag-cross::before {
  /* barre horizontale */
  top: 50%;
  left: 30%;
  right: 30%;
  height: 2px;
  transform: translateY(-50%);
}
.ps-flag-cross::after {
  /* barre verticale */
  top: 25%;
  bottom: 25%;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
}

/* ─── Desktop ─────────────────────────────────────────────────── */
.profile-desktop {
  min-height: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-muted);
}
.profile-desktop__header {
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 16px 28px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.profile-desktop__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.profile-desktop__brand-name {
  font-size: 13px;
  font-weight: 600;
}
.profile-desktop__user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.profile-desktop__user-email {
  font-size: 13px;
  font-weight: 500;
}
.profile-desktop__scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 48px 24px;
}
.profile-desktop__container {
  width: 100%;
  max-width: 560px;
}
.profile-desktop__title {
  font-size: 26px;
}
.profile-desktop__sub {
  margin-top: 8px;
}
.profile-desktop__card {
  margin-top: 24px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-md);
}
.profile-desktop__actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* Logo placeholder (en attendant un vrai CbLogo). */
.cb-logo {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--emerald-600);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.04em;
}

/* Avatar emerald (utilisé dans le header desktop). */
.cb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
}
.cb-avatar.emerald {
  background: var(--emerald-100);
  color: var(--emerald-700);
}
</style>
