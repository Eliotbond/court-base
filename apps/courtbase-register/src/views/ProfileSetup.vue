<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Globe,
  Lock,
  Mail,
  User,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const displayName = ref('')
const email = ref('')
const phone = ref('')
const street = ref('')
const streetNumber = ref('')
const zip = ref('')
const city = ref('')
const country = ref('CH')
const photoURL = ref('')

const error = ref<string | null>(null)
const submitting = ref(false)

/**
 * Sépare une chaîne "Rue de la gare 12" en `{ street: "Rue de la gare", num: "12" }`.
 * Si pas de numéro détectable, tout va dans `street`.
 */
function splitStreet(full: string | undefined | null): { street: string; num: string } {
  if (!full) return { street: '', num: '' }
  const match = full.trim().match(/^(.*?)\s+([0-9][0-9a-zA-Z\-/]*)$/)
  if (match && match[1] && match[2]) {
    return { street: match[1].trim(), num: match[2].trim() }
  }
  return { street: full.trim(), num: '' }
}

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

const countryName = computed(
  () => COUNTRIES.find((c) => c.code === country.value)?.name ?? 'Suisse',
)

const emailVerified = computed(() => Boolean(auth.authSnap?.email))

onMounted(async () => {
  // Cas E (idempotence) : si l'utilisateur arrive sur /profile alors que son
  // doc /users/{uid} existe déjà (ex. retour navigation, double-click sur
  // /profile, ou ouverture d'un onglet stale), on redirige vers /home plutôt
  // que d'afficher un formulaire vide qui forcerait une re-saisie.
  if (auth.hasProfile) {
    await router.replace({ name: 'home' })
    return
  }

  // Pré-remplit depuis l'identité OAuth (Google/Apple → displayName, email,
  // photoURL) + depuis un éventuel doc /users/{uid} partiel (cas défensif :
  // doc créé mais sans tous les champs — ne se produit pas via cette app
  // mais possible via admin SDK).
  const doc = auth.userDoc
  displayName.value = doc?.displayName ?? auth.authSnap?.displayName ?? ''
  email.value = doc?.email ?? auth.authSnap?.email ?? ''
  photoURL.value = doc?.photoURL ?? auth.authSnap?.photoURL ?? ''
  phone.value = doc?.phone ?? ''
  const addr = doc?.address
  if (addr) {
    const parts = splitStreet(addr.street)
    street.value = parts.street
    streetNumber.value = parts.num
    zip.value = addr.zip ?? ''
    city.value = addr.city ?? ''
    country.value = addr.country ?? 'CH'
  }
})

function validate(): string | null {
  if (!displayName.value.trim()) return 'Le nom est obligatoire.'
  if (!email.value.trim()) return "L'email est obligatoire."
  if (!phone.value.trim()) return 'Le téléphone est obligatoire.'
  if (!street.value.trim()) return 'La rue est obligatoire.'
  if (!streetNumber.value.trim()) return 'Le numéro est obligatoire.'
  if (!zip.value.trim()) return 'Le code postal est obligatoire.'
  if (!city.value.trim()) return 'La ville est obligatoire.'
  if (!country.value.trim()) return 'Le pays est obligatoire.'
  return null
}

async function onSubmit() {
  error.value = null
  const v = validate()
  if (v) {
    error.value = v
    return
  }

  submitting.value = true
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
      photoURL: photoURL.value,
    })
    await router.replace({ name: 'home' })
  } catch (e) {
    if (e instanceof FirebaseError) {
      error.value = e.message
    } else if (e instanceof Error) {
      error.value = e.message
    } else {
      error.value = "Échec de l'enregistrement. Réessayez."
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <div
        class="brand-mark"
        style="width: 28px; height: 28px; border-radius: 8px; font-size: 12px;"
      >
        M
      </div>
      <div class="header__id">
        <div class="header__name">Marly Basket</div>
        <div class="header__role">Création de votre compte</div>
      </div>
      <div class="header__step">
        <span class="pill pill-slate header__pill">ÉTAPE 0 / 8</span>
      </div>
    </div>

    <div class="m-content">
      <h1 class="profile__title">
        Quelques infos pour commencer
      </h1>
      <p class="profile__sub">
        Ces informations restent privées et ne sont utilisées que par l'administration du club.
      </p>

      <form
        class="profile__form"
        @submit.prevent="onSubmit"
      >
        <div
          class="card"
          style="padding: 16px; display: flex; flex-direction: column; gap: 16px;"
        >
          <div>
            <label
              for="profile-displayName"
              class="label"
            >Nom complet</label>
            <div class="input-wrap">
              <User class="input-icon" />
              <input
                id="profile-displayName"
                v-model="displayName"
                class="input with-icon-left"
                autocomplete="name"
                required
                :disabled="submitting"
              />
            </div>
          </div>

          <div>
            <label
              for="profile-email"
              class="label profile__label-row"
            >
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
                id="profile-email"
                v-model="email"
                class="input with-icon-left"
                type="email"
                autocomplete="email"
                :readonly="emailVerified"
                required
                :disabled="submitting"
              />
            </div>
          </div>

          <div>
            <label
              for="profile-phone"
              class="label"
            >Téléphone</label>
            <div class="profile__phone">
              <button
                type="button"
                class="btn btn-secondary btn-sm profile__country-prefix"
                tabindex="-1"
              >
                <span class="profile__flag">🇨🇭</span> +41 <ChevronDown :size="14" />
              </button>
              <input
                id="profile-phone"
                v-model="phone"
                class="input"
                type="tel"
                autocomplete="tel"
                placeholder="79 432 12 88"
                required
                :disabled="submitting"
              />
            </div>
          </div>
        </div>

        <div class="profile__section-label">
          ADRESSE
        </div>

        <div
          class="card"
          style="padding: 16px; display: flex; flex-direction: column; gap: 16px;"
        >
          <div class="profile__grid-3">
            <div style="grid-column: span 2;">
              <label
                for="profile-street"
                class="label"
              >Rue</label>
              <input
                id="profile-street"
                v-model="street"
                class="input"
                autocomplete="street-address"
                required
                :disabled="submitting"
              />
            </div>
            <div>
              <label
                for="profile-num"
                class="label"
              >N°</label>
              <input
                id="profile-num"
                v-model="streetNumber"
                class="input"
                required
                :disabled="submitting"
              />
            </div>
          </div>

          <div class="profile__grid-3">
            <div>
              <label
                for="profile-zip"
                class="label"
              >NPA</label>
              <input
                id="profile-zip"
                v-model="zip"
                class="input"
                autocomplete="postal-code"
                required
                :disabled="submitting"
              />
            </div>
            <div style="grid-column: span 2;">
              <label
                for="profile-city"
                class="label"
              >Ville</label>
              <input
                id="profile-city"
                v-model="city"
                class="input"
                autocomplete="address-level2"
                required
                :disabled="submitting"
              />
            </div>
          </div>

          <div>
            <label
              for="profile-country"
              class="label"
            >Pays</label>
            <div class="input-wrap">
              <Globe class="input-icon" />
              <select
                id="profile-country"
                v-model="country"
                class="input with-icon-left profile__select"
                :disabled="submitting"
              >
                <option
                  v-for="opt in COUNTRIES"
                  :key="opt.code"
                  :value="opt.code"
                >
                  {{ opt.name }}
                </option>
              </select>
              <ChevronDown class="profile__select-chevron" />
            </div>
          </div>
        </div>

        <p
          v-if="error"
          class="helper-error profile__error"
        >
          <AlertCircle :size="14" /> {{ error }}
        </p>

        <p class="profile__rgpd">
          <Lock :size="12" />
          Vos données ne sont jamais partagées avec d'autres clubs ou la fédération sans votre accord.
        </p>
      </form>
    </div>

    <div class="m-bottom">
      <button
        type="submit"
        class="btn btn-primary btn-block"
        :disabled="submitting"
        @click="onSubmit"
      >
        Continuer <ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.header__id {
  line-height: 1.2;
}
.header__name {
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
}
.header__role {
  font-size: 10.5px;
  color: #64748b;
}
.header__step {
  margin-left: auto;
}
.header__pill {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.profile__title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: #0f172a;
}
.profile__sub {
  font-size: 13px;
  color: #64748b;
  margin: 6px 0 0 0;
  line-height: 1.6;
}

.profile__form {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 20px;
}

.profile__label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile__phone {
  display: flex;
  gap: 8px;
}
.profile__country-prefix {
  height: 44px;
  padding: 0 10px;
}
.profile__flag {
  font-size: 15px;
}

.profile__section-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.08em;
  margin: 20px 0 8px 0;
}

.profile__grid-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.profile__select {
  appearance: none;
  background-image: none;
  padding-right: 36px;
}
.profile__select-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
  width: 14px;
  height: 14px;
}

.profile__error {
  margin: 16px 0 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff1f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  display: flex;
  align-items: center;
  gap: 6px;
}

.profile__rgpd {
  font-size: 11.5px;
  color: #64748b;
  margin: 16px 12px 0 12px;
  line-height: 1.6;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
