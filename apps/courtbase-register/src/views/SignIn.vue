<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import { AlertCircle, ArrowRight, ChevronLeft, Lock, Mail, User } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

type Mode = 'signin' | 'signup'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const mode = ref<Mode>('signin')
const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const displayName = ref('')
const error = ref<string | null>(null)
const resetSent = ref(false)

const submitLabel = computed(() =>
  mode.value === 'signin' ? 'Continuer' : 'Créer mon compte',
)

const title = computed(() => (mode.value === 'signin' ? 'Bon retour' : 'Créez votre compte'))
const subtitle = computed(() =>
  mode.value === 'signin'
    ? 'Connectez-vous pour gérer vos inscriptions.'
    : 'Quelques infos pour démarrer.',
)

function setMode(next: Mode) {
  if (mode.value === next) return
  mode.value = next
  error.value = null
  resetSent.value = false
}

function messageFor(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou mot de passe incorrect.'
    case 'auth/invalid-email':
      return 'Adresse email invalide.'
    case 'auth/user-disabled':
      return 'Ce compte est désactivé.'
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet email. Connectez-vous plutôt que de créer un compte.'
    case 'auth/weak-password':
      return 'Mot de passe trop faible. 6 caractères minimum.'
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Réessayez plus tard.'
    case 'auth/network-request-failed':
      return 'Problème réseau. Vérifiez votre connexion.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Connexion annulée.'
    case 'auth/popup-blocked':
      return 'La fenêtre de connexion a été bloquée par le navigateur.'
    case 'auth/account-exists-with-different-credential':
      return 'Un compte existe déjà avec cet email, via un autre fournisseur.'
    case 'auth/operation-not-allowed':
      return "Ce fournisseur n'est pas activé pour ce projet."
    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé pour cette connexion."
    default:
      return 'Échec de la connexion. Réessayez.'
  }
}

function handleError(e: unknown) {
  if (e instanceof FirebaseError) {
    error.value = messageFor(e.code)
    return
  }
  error.value = 'Échec de la connexion. Réessayez.'
}

async function redirectAfterAuth() {
  const redirect = route.query.redirect
  const fallback = auth.hasProfile ? '/home' : '/profile'
  const target =
    typeof redirect === 'string' && redirect.startsWith('/') ? redirect : fallback
  await router.replace(target)
}

async function onSubmit() {
  error.value = null
  resetSent.value = false
  if (mode.value === 'signup') {
    if (password.value !== passwordConfirm.value) {
      error.value = 'Les mots de passe ne correspondent pas.'
      return
    }
    if (password.value.length < 6) {
      error.value = 'Mot de passe trop court (6 caractères minimum).'
      return
    }
  }
  try {
    if (mode.value === 'signin') {
      await auth.signIn(email.value, password.value)
    } else {
      await auth.signUp(email.value, password.value, displayName.value)
    }
    await redirectAfterAuth()
  } catch (e) {
    handleError(e)
  }
}

async function onGoogle() {
  error.value = null
  try {
    await auth.signInWithGoogle()
    await redirectAfterAuth()
  } catch (e) {
    handleError(e)
  }
}

async function onResetPassword() {
  error.value = null
  resetSent.value = false
  if (!email.value.trim()) {
    error.value = 'Saisissez votre email avant de demander la réinitialisation.'
    return
  }
  try {
    await auth.resetPassword(email.value.trim())
    resetSent.value = true
  } catch (e) {
    handleError(e)
  }
}

function goBack() {
  router.push({ name: 'landing' })
}
</script>

<template>
  <div class="m-app">
    <div class="m-header">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        style="margin-left: -8px;"
        @click="goBack"
      >
        <ChevronLeft :size="16" />
      </button>
      <div class="header__label">Autre méthode</div>
    </div>

    <div class="m-content no-bg">
      <!-- Mode toggle -->
      <div class="tabs">
        <button
          type="button"
          class="tabs__btn"
          :class="{ 'tabs__btn--active': mode === 'signin' }"
          @click="setMode('signin')"
        >
          Connexion
        </button>
        <button
          type="button"
          class="tabs__btn"
          :class="{ 'tabs__btn--active': mode === 'signup' }"
          @click="setMode('signup')"
        >
          Créer un compte
        </button>
      </div>

      <h1 class="signin__title">
        {{ title }}
      </h1>
      <p class="signin__sub">
        {{ subtitle }}
      </p>

      <form
        class="signin__form"
        @submit.prevent="onSubmit"
      >
        <div v-if="mode === 'signup'">
          <label
            for="displayName"
            class="label"
          >Nom complet</label>
          <div class="input-wrap">
            <User class="input-icon" />
            <input
              id="displayName"
              v-model="displayName"
              class="input with-icon-left"
              autocomplete="name"
              required
              :disabled="auth.loading"
            />
          </div>
        </div>

        <div>
          <label
            for="email"
            class="label"
          >Email</label>
          <div class="input-wrap">
            <Mail class="input-icon" />
            <input
              id="email"
              v-model="email"
              class="input with-icon-left"
              type="email"
              autocomplete="email"
              required
              :disabled="auth.loading"
            />
          </div>
        </div>

        <div>
          <div class="signin__label-row">
            <label
              for="password"
              class="label"
              style="margin: 0;"
            >Mot de passe</label>
            <button
              v-if="mode === 'signin'"
              type="button"
              class="btn btn-text signin__forgot"
              :disabled="auth.loading"
              @click="onResetPassword"
            >
              Mot de passe oublié&nbsp;?
            </button>
          </div>
          <div class="input-wrap">
            <Lock class="input-icon" />
            <input
              id="password"
              v-model="password"
              class="input with-icon-left"
              :class="{ error: !!error }"
              type="password"
              :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
              required
              :disabled="auth.loading"
            />
          </div>
          <div
            v-if="error"
            class="helper-error"
            style="display: flex; align-items: center; gap: 6px;"
          >
            <AlertCircle :size="14" /> {{ error }}
          </div>
        </div>

        <div v-if="mode === 'signup'">
          <label
            for="passwordConfirm"
            class="label"
          >Confirmer le mot de passe</label>
          <div class="input-wrap">
            <Lock class="input-icon" />
            <input
              id="passwordConfirm"
              v-model="passwordConfirm"
              class="input with-icon-left"
              type="password"
              autocomplete="new-password"
              required
              :disabled="auth.loading"
            />
          </div>
        </div>

        <p
          v-if="resetSent"
          class="signin__notice"
        >
          Email de réinitialisation envoyé. Vérifiez votre boîte de réception.
        </p>

        <button
          type="submit"
          class="btn btn-primary btn-block"
          style="height: 46px; margin-top: 8px;"
          :disabled="auth.loading"
        >
          {{ submitLabel }} <ArrowRight :size="14" />
        </button>
      </form>

      <div
        class="ortext"
        style="margin: 24px 0;"
      >
        <span>ou</span>
      </div>

      <div class="signin__providers">
        <button
          type="button"
          class="btn btn-secondary btn-block"
          style="height: 44px;"
          :disabled="auth.loading"
          @click="onGoogle"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continuer avec Google
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header__label {
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}

.tabs {
  display: flex;
  padding: 4px;
  background: #f4f4f5;
  border-radius: 8px;
  margin-bottom: 20px;
  width: 100%;
}
.tabs__btn {
  flex: 1;
  height: 36px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.tabs__btn--active {
  background: white;
  color: #0f172a;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.signin__title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: #0f172a;
}
.signin__sub {
  font-size: 13px;
  color: #64748b;
  margin: 4px 0 0 0;
}

.signin__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
}

.signin__label-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.signin__forgot {
  font-size: 12px;
}

.signin__notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  font-size: 12.5px;
}

.signin__providers {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
