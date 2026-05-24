<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Mail, XCircle } from 'lucide-vue-next'

import { useViewport } from '@/composables/useViewport'
import { useAuthStore } from '@/stores/auth'

/**
 * C1 — Sign-in.
 *
 * Port fidèle du JSX `screens/common.jsx` (sections `SignInMobile` +
 * `SignInDesktop`). Différence avec ce que les agents avaient produit :
 *  - **Desktop split-screen** : panneau gauche gradient slate avec hero
 *    marketing, panneau droit fond blanc avec form (cf. JSX bundle).
 *  - **Boutons OAuth** : icône à gauche, label centré (pas centré bête).
 *
 * Auth : utilise le **vrai store Firebase Auth** (deny-orphan +
 * acceptInvitation). En cas de compte non autorisé → toast rose.
 *
 * Le mode "email" ouvre un sous-formulaire dans la même vue (pas de
 * navigation séparée — cohérent avec le `goEmailMode` du JSX).
 */

const APP_VERSION = '0.4.2'
const CONTACT_EMAIL = 'admin@aigles.ch'
const CLUB_INITIALS = 'BCA'
const CLUB_NAME = 'BC Aigles'
const SEASON_LABEL = 'Saison 2025/26'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const { isDesktop } = useViewport()

type Mode = 'choice' | 'email-signin' | 'email-signup'
const mode = ref<Mode>('choice')

const email = ref('')
const password = ref('')
const passwordConfirm = ref('')
const displayNameInput = ref('')

const isSignup = computed(() => mode.value === 'email-signup')

const mailto = computed(() => {
  const subject = encodeURIComponent(`Accès courtbase-app — ${CLUB_NAME}`)
  const body = encodeURIComponent(
    `Bonjour,\n\nJe n'arrive pas à me connecter à l'app courtbase-app du club ${CLUB_NAME}.\nMon adresse email : \n\nMerci pour votre aide.`,
  )
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
})

const redirect = computed(() => {
  const r = route.query['redirect']
  return typeof r === 'string' ? r : '/'
})

/** Bouton primaire désactivé pendant action async. */
const loading = computed(() => auth.loading)

async function navigatePostSignIn(): Promise<void> {
  // Le router beforeEach se chargera de rediriger vers profile-setup ou
  // member-inactive si nécessaire — on tente d'aller sur la cible voulue.
  await router.push(redirect.value || '/')
}

async function onGoogle(): Promise<void> {
  try {
    await auth.signInWithGoogle()
    if (auth.isSignedIn) await navigatePostSignIn()
  } catch {
    // L'erreur est déjà capturée dans `auth.lastError`.
  }
}

async function onEmailSubmit(): Promise<void> {
  if (!email.value || !password.value) return
  if (isSignup.value && password.value !== passwordConfirm.value) return
  try {
    if (isSignup.value) {
      await auth.signUpWithEmailPassword(email.value, password.value, displayNameInput.value)
    } else {
      await auth.signInWithEmailPassword(email.value, password.value)
    }
    if (auth.isSignedIn) await navigatePostSignIn()
  } catch {
    /* lastError set */
  }
}

async function onForgotPassword(): Promise<void> {
  if (!email.value) {
    // Pas d'email saisi — on demande à l'utilisateur de remplir d'abord.
    return
  }
  try {
    await auth.requestPasswordReset(email.value)
    auth.dismissError()
    // TODO : afficher un toast emerald "Email envoyé". Pour l'instant
    // pas de feedback UI explicite — l'utilisateur recevra l'email.
  } catch {
    /* lastError set */
  }
}

function goEmailMode(): void {
  mode.value = 'email-signin'
  auth.dismissError()
}
function backToChoice(): void {
  mode.value = 'choice'
  auth.dismissError()
}
function toggleSignup(): void {
  mode.value = mode.value === 'email-signin' ? 'email-signup' : 'email-signin'
  auth.dismissError()
}
</script>

<template>
  <!-- ──────────────────────────────────────────────────────────────
       Desktop ≥1024px — split-screen 1.1fr / 1fr (port JSX SignInDesktop)
       ────────────────────────────────────────────────────────────── -->
  <div
    v-if="isDesktop"
    class="cb"
    style="height: 100%; background: var(--bg-muted); display: grid; grid-template-columns: 1.1fr 1fr"
  >
    <!-- Panel gauche : gradient slate-900 → slate-800 + hero marketing -->
    <div
      class="signin-hero-panel"
      style="
        background: linear-gradient(160deg, var(--slate-900), var(--slate-800));
        color: #fff;
        padding: 60px 56px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      "
    >
      <div class="cb-logo" style="background: rgba(255, 255, 255, 0.1)">{{ CLUB_INITIALS }}</div>
      <div>
        <div
          style="
            font-size: 13px;
            opacity: 0.7;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.1em;
          "
        >
          courtbase-app
        </div>
        <h1
          style="
            font-size: 38px;
            font-weight: 700;
            margin-top: 12px;
            letter-spacing: -0.025em;
            line-height: 1.1;
          "
        >
          L'outil de terrain<br />du {{ CLUB_NAME }}.
        </h1>
        <p
          style="
            margin-top: 16px;
            font-size: 15px;
            opacity: 0.75;
            line-height: 1.5;
            max-width: 380px;
          "
        >
          Présences, assignations officiels, demandes — directement depuis le banc ou le bus.
        </p>
      </div>
      <div style="font-size: 12px; opacity: 0.55">{{ SEASON_LABEL }} · {{ CLUB_NAME }}</div>
    </div>

    <!-- Panel droit : fond blanc, form max-width 360 centré -->
    <div
      style="
        background: var(--bg);
        display: flex;
        flex-direction: column;
        padding: 60px 32px;
        position: relative;
      "
    >
      <div style="max-width: 360px; margin: auto; width: 100%">
        <h2 class="cb-h1" style="font-size: 24px">
          {{ mode === 'choice' ? 'Connexion' : isSignup ? 'Créer un compte' : 'Se connecter' }}
        </h2>
        <p class="cb-sub" style="margin-top: 6px; margin-bottom: 28px">
          <template v-if="mode === 'choice'">L'accès se fait sur invitation. Utilisez le compte fourni par votre club.</template>
          <template v-else-if="isSignup">Indiquez l'email reçu de votre club.</template>
          <template v-else>Avec l'email et le mot de passe de votre invitation.</template>
        </p>

        <!-- Choix méthode -->
        <div v-if="mode === 'choice'" style="display: flex; flex-direction: column; gap: 10px">
          <button
            type="button"
            class="cb-btn outline lg block signin-oauth"
            :disabled="loading"
            @click="onGoogle"
          >
            <span class="signin-oauth-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.49 5.49 0 0 1-2.4 3.62v3.01h3.86c2.27-2.09 3.59-5.17 3.59-8.87Z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.92l-3.86-3a7.18 7.18 0 0 1-10.73-3.78H1.36v3.1A12 12 0 0 0 12 24Z"/>
                <path fill="#FBBC05" d="M5.35 14.3a7.18 7.18 0 0 1 0-4.6V6.6H1.36a12 12 0 0 0 0 10.8l3.99-3.1Z"/>
                <path fill="#EA4335" d="M12 4.77a6.52 6.52 0 0 1 4.6 1.8l3.43-3.43A11.61 11.61 0 0 0 12 0 12 12 0 0 0 1.36 6.6l3.99 3.1A7.18 7.18 0 0 1 12 4.77Z"/>
              </svg>
            </span>
            <span class="signin-oauth-label">Continuer avec Google</span>
          </button>
          <button
            type="button"
            class="cb-btn outline lg block signin-oauth"
            :disabled="loading"
            @click="goEmailMode"
          >
            <span class="signin-oauth-icon" aria-hidden="true">
              <Mail :size="20" />
            </span>
            <span class="signin-oauth-label">Continuer avec un email</span>
          </button>
        </div>

        <!-- Form email -->
        <form v-else style="display: flex; flex-direction: column; gap: 12px" @submit.prevent="onEmailSubmit">
          <button
            type="button"
            class="signin-back-link"
            style="font-size: 12.5px; color: var(--text-subtle); text-align: left; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; align-self: flex-start; margin-bottom: 4px"
            @click="backToChoice"
          >
            ← Autre méthode
          </button>
          <div v-if="isSignup" class="cb-field">
            <label>Nom complet</label>
            <input v-model="displayNameInput" class="cb-input" type="text" autocomplete="name" placeholder="Prénom Nom" />
          </div>
          <div class="cb-field">
            <label>Email</label>
            <input v-model="email" class="cb-input" type="email" inputmode="email" autocomplete="email" placeholder="prenom.nom@example.ch" required />
          </div>
          <div class="cb-field">
            <label>Mot de passe</label>
            <input
              v-model="password"
              class="cb-input"
              type="password"
              :autocomplete="isSignup ? 'new-password' : 'current-password'"
              placeholder="••••••••"
              required
            />
          </div>
          <div v-if="isSignup" class="cb-field">
            <label>Confirmer le mot de passe</label>
            <input v-model="passwordConfirm" class="cb-input" type="password" autocomplete="new-password" placeholder="••••••••" required />
            <div v-if="passwordConfirm && passwordConfirm !== password" class="cb-error">
              Les mots de passe ne correspondent pas.
            </div>
          </div>
          <button type="submit" class="cb-btn primary lg block" :disabled="loading">
            {{ loading ? 'Connexion…' : isSignup ? 'Créer le compte' : 'Continuer' }}
          </button>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; margin-top: 4px">
            <button v-if="!isSignup" type="button" class="signin-link-btn" @click="onForgotPassword">
              J'ai oublié mon mot de passe
            </button>
            <span v-else style="opacity: 0" />
            <button type="button" class="signin-link-btn" @click="toggleSignup">
              {{ isSignup ? 'J\'ai déjà un compte' : 'Créer un compte' }}
            </button>
          </div>
        </form>

        <div v-if="mode === 'choice'" style="margin-top: 28px; text-align: center; font-size: 13px; color: var(--text-subtle)">
          <a :href="mailto" style="text-decoration: underline">
            J'ai déjà essayé sans succès — contactez le club
          </a>
        </div>
      </div>
      <div
        style="
          position: absolute;
          bottom: 24px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 11px;
          color: var(--text-faint);
        "
      >
        courtbase-app v{{ APP_VERSION }} ·
        <a href="#" style="text-decoration: underline">Mentions légales</a>
      </div>

      <!-- Erreur top-right desktop -->
      <div
        v-if="auth.lastError"
        role="alert"
        style="
          position: absolute;
          top: 24px;
          right: 24px;
          padding: 12px 16px;
          border-radius: 10px;
          background: var(--rose-600);
          color: #fff;
          display: flex;
          gap: 10px;
          align-items: center;
          box-shadow: var(--shadow-md);
          max-width: 360px;
          z-index: 10;
        "
      >
        <XCircle :size="18" />
        <div style="font-size: 13px">{{ auth.lastError }}</div>
        <button
          type="button"
          aria-label="Fermer"
          style="background: none; border: 0; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; opacity: 0.7"
          @click="auth.dismissError()"
        >
          ×
        </button>
      </div>
    </div>
  </div>

  <!-- ──────────────────────────────────────────────────────────────
       Mobile <1024px — layout vertical centré (port JSX SignInMobile)
       ────────────────────────────────────────────────────────────── -->
  <div v-else class="cb cb-mobile" style="background: var(--bg)">
    <div
      class="cb-mobile-body plain"
      style="display: flex; flex-direction: column; padding: 0 24px; position: relative"
    >
      <!-- Hero (mode choice uniquement) -->
      <div
        v-if="mode === 'choice'"
        style="flex: 1; display: flex; flex-direction: column; justify-content: center"
      >
        <div style="text-align: center; margin-bottom: 40px">
          <div class="cb-logo lg" style="margin: 0 auto 20px">{{ CLUB_INITIALS }}</div>
          <h1 class="cb-h1" style="font-size: 22px">Connexion équipe {{ CLUB_NAME }}</h1>
          <p class="cb-sub" style="margin-top: 6px">Coachs, officiels et admins du club.</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px">
          <button
            type="button"
            class="cb-btn outline lg block signin-oauth"
            :disabled="loading"
            @click="onGoogle"
          >
            <span class="signin-oauth-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.49 5.49 0 0 1-2.4 3.62v3.01h3.86c2.27-2.09 3.59-5.17 3.59-8.87Z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.92l-3.86-3a7.18 7.18 0 0 1-10.73-3.78H1.36v3.1A12 12 0 0 0 12 24Z"/>
                <path fill="#FBBC05" d="M5.35 14.3a7.18 7.18 0 0 1 0-4.6V6.6H1.36a12 12 0 0 0 0 10.8l3.99-3.1Z"/>
                <path fill="#EA4335" d="M12 4.77a6.52 6.52 0 0 1 4.6 1.8l3.43-3.43A11.61 11.61 0 0 0 12 0 12 12 0 0 0 1.36 6.6l3.99 3.1A7.18 7.18 0 0 1 12 4.77Z"/>
              </svg>
            </span>
            <span class="signin-oauth-label">Continuer avec Google</span>
          </button>
          <button
            type="button"
            class="cb-btn outline lg block signin-oauth"
            :disabled="loading"
            @click="goEmailMode"
          >
            <span class="signin-oauth-icon" aria-hidden="true">
              <Mail :size="20" />
            </span>
            <span class="signin-oauth-label">Continuer avec un email</span>
          </button>
        </div>

        <div style="text-align: center; margin-top: 28px">
          <a :href="mailto" style="font-size: 12.5px; color: var(--text-subtle); text-decoration: underline">
            J'ai déjà essayé sans succès — contactez le club
          </a>
        </div>

        <div
          style="
            text-align: center;
            margin-top: auto;
            padding-top: 32px;
            padding-bottom: 32px;
            font-size: 11px;
            color: var(--text-faint);
          "
        >
          courtbase-app v{{ APP_VERSION }} ·
          <a href="#" style="text-decoration: underline">Mentions légales</a>
        </div>
      </div>

      <!-- Mode email (mobile) -->
      <form
        v-else
        style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 14px"
        @submit.prevent="onEmailSubmit"
      >
        <button
          type="button"
          style="font-size: 13px; color: var(--text-subtle); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; align-self: flex-start"
          @click="backToChoice"
        >
          ← Autre méthode
        </button>
        <div style="text-align: left; margin-bottom: 8px">
          <h1 class="cb-h1" style="font-size: 22px">
            {{ isSignup ? 'Créer un compte' : 'Se connecter' }}
          </h1>
          <p class="cb-sub" style="margin-top: 6px">
            {{ isSignup ? 'Indiquez l\'email reçu de votre club.' : 'Avec l\'email et le mot de passe de votre invitation.' }}
          </p>
        </div>
        <div v-if="isSignup" class="cb-field">
          <label>Nom complet</label>
          <input v-model="displayNameInput" class="cb-input" type="text" autocomplete="name" placeholder="Prénom Nom" />
        </div>
        <div class="cb-field">
          <label>Email</label>
          <input v-model="email" class="cb-input" type="email" inputmode="email" autocomplete="email" placeholder="prenom.nom@example.ch" required />
        </div>
        <div class="cb-field">
          <label>Mot de passe</label>
          <input
            v-model="password"
            class="cb-input"
            type="password"
            :autocomplete="isSignup ? 'new-password' : 'current-password'"
            placeholder="••••••••"
            required
          />
        </div>
        <div v-if="isSignup" class="cb-field">
          <label>Confirmer le mot de passe</label>
          <input v-model="passwordConfirm" class="cb-input" type="password" autocomplete="new-password" placeholder="••••••••" required />
          <div v-if="passwordConfirm && passwordConfirm !== password" class="cb-error">
            Les mots de passe ne correspondent pas.
          </div>
        </div>
        <button type="submit" class="cb-btn primary lg block" :disabled="loading">
          {{ loading ? 'Connexion…' : isSignup ? 'Créer le compte' : 'Continuer' }}
        </button>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px">
          <button v-if="!isSignup" type="button" class="signin-link-btn" @click="onForgotPassword">
            J'ai oublié mon mot de passe
          </button>
          <span v-else style="opacity: 0" />
          <button type="button" class="signin-link-btn" @click="toggleSignup">
            {{ isSignup ? 'J\'ai déjà un compte' : 'Créer un compte' }}
          </button>
        </div>
      </form>

      <!-- Toast erreur deny-orphan (mobile) -->
      <div
        v-if="auth.lastError"
        class="cb-toast rose"
        role="alert"
        style="bottom: 24px"
      >
        <XCircle :size="18" />
        <div>{{ auth.lastError }}</div>
        <button
          type="button"
          aria-label="Fermer"
          style="background: none; border: 0; color: #fff; font-size: 18px; line-height: 1; cursor: pointer; opacity: 0.7; margin-left: auto"
          @click="auth.dismissError()"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Boutons OAuth — icône à gauche, label centré (paddingRight compense le
   gap pour que le texte tombe au milieu du bouton). Port direct du JSX. */
.signin-oauth {
  justify-content: flex-start;
  padding-left: 16px;
  gap: 12px;
}
.signin-oauth-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.signin-oauth-label {
  flex: 1;
  text-align: center;
  padding-right: 24px;
}

/* Liens textuels (forgot password, toggle signup). */
.signin-link-btn {
  background: none;
  border: 0;
  color: var(--text-subtle);
  text-decoration: underline;
  font-size: 12.5px;
  cursor: pointer;
  padding: 4px 0;
  font-family: inherit;
}
.signin-link-btn:hover {
  color: var(--text);
}
</style>
