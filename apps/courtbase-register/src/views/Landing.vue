<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import { Mail } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const error = ref<string | null>(null)

function messageFor(code: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Connexion annulée.'
    case 'auth/popup-blocked':
      return 'La fenêtre de connexion a été bloquée par le navigateur.'
    case 'auth/account-exists-with-different-credential':
      return 'Un compte existe déjà avec cet email, via un autre fournisseur.'
    case 'auth/network-request-failed':
      return 'Problème réseau. Vérifiez votre connexion.'
    case 'auth/operation-not-allowed':
      return "Ce fournisseur n'est pas activé pour ce projet."
    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé pour cette connexion."
    default:
      return 'Échec de la connexion. Réessayez.'
  }
}

async function redirectAfterAuth() {
  const redirect = route.query.redirect
  const fallback = auth.hasProfile ? '/home' : '/profile'
  const target =
    typeof redirect === 'string' && redirect.startsWith('/') ? redirect : fallback
  await router.replace(target)
}

function handleError(e: unknown) {
  if (e instanceof FirebaseError) {
    error.value = messageFor(e.code)
    return
  }
  error.value = 'Échec de la connexion. Réessayez.'
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

async function onApple() {
  error.value = null
  try {
    await auth.signInWithApple()
    await redirectAfterAuth()
  } catch (e) {
    handleError(e)
  }
}

function goSignIn() {
  router.push({ name: 'signin' })
}
</script>

<template>
  <div class="m-app">
    <div class="m-content no-bg" style="padding: 0; background: white;">
      <!-- Hero -->
      <div class="hero">
        <div class="brand-mark brand-mark-lg mx-auto">M</div>
        <h1 class="hero__title">
          Inscriptions<br />Marly Basket
        </h1>
        <p class="hero__sub">
          Rejoignez le club en quelques minutes — pour vous ou pour votre enfant.
        </p>
      </div>

      <!-- How it works -->
      <div class="howto">
        <div class="howto__label">COMMENT ÇA MARCHE</div>

        <div class="howto__step">
          <div class="howto__num">1</div>
          <div class="howto__body">
            <div class="howto__title">Créez votre compte</div>
            <div class="howto__desc">Email, Google ou Apple. 30 secondes.</div>
          </div>
        </div>

        <div class="howto__step">
          <div class="howto__num">2</div>
          <div class="howto__body">
            <div class="howto__title">Choisissez une équipe</div>
            <div class="howto__desc">Et complétez l'inscription du joueur.</div>
          </div>
        </div>

        <div class="howto__step">
          <div class="howto__num">3</div>
          <div class="howto__body">
            <div class="howto__title">Le coach vous contacte</div>
            <div class="howto__desc">Pour un essai, puis l'établissement de la licence.</div>
          </div>
        </div>
      </div>

      <!-- CTAs -->
      <div class="ctas">
        <p
          v-if="error"
          class="ctas__error"
        >
          {{ error }}
        </p>

        <button
          type="button"
          class="btn btn-secondary btn-block ctas__btn"
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

        <button
          type="button"
          class="btn btn-secondary btn-block ctas__btn"
          :disabled="auth.loading"
          @click="onApple"
        >
          <svg
            width="14"
            height="16"
            viewBox="0 0 14 16"
            aria-hidden="true"
          >
            <path
              fill="#000"
              d="M11.5 8.5c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8C2.5 3.6.8 4.6 0 6.4c-1.2 2-.3 5 .9 6.7.6.8 1.3 1.7 2.2 1.7.9 0 1.2-.6 2.3-.6 1.1 0 1.4.6 2.3.6.9 0 1.5-.8 2.1-1.6.7-.9.9-1.9.9-1.9-.1 0-1.7-.7-1.7-2.8zm-2.2-5.3c.5-.6.8-1.4.7-2.2-.7 0-1.5.4-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.6-.4 2-.9z"
            />
          </svg>
          Continuer avec Apple
        </button>

        <button
          type="button"
          class="btn btn-secondary btn-block ctas__btn"
          @click="goSignIn"
        >
          <Mail :size="16" />
          Continuer avec email
        </button>

        <button
          type="button"
          class="btn btn-text ctas__alt"
          @click="goSignIn"
        >
          J'ai déjà un compte
        </button>
      </div>

      <div class="footer">
        Marly Basket · <a class="footer__link">marlybasket.ch</a><br />
        En continuant, vous acceptez nos
        <a class="footer__link">mentions légales</a>
        &amp; la politique RGPD.
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  padding: 32px 24px 24px;
  text-align: center;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
  border-bottom: 1px solid #eef2f6;
}
.mx-auto {
  margin-left: auto;
  margin-right: auto;
}
.hero__title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 16px 0 0 0;
  line-height: 1.2;
  color: #0f172a;
}
.hero__sub {
  font-size: 13.5px;
  color: #475569;
  margin: 8px 8px 0 8px;
  line-height: 1.6;
}

.howto {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.howto__label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #64748b;
  letter-spacing: 0.08em;
}
.howto__step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.howto__num {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #d1fae5;
  color: #047857;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12.5px;
  font-weight: 600;
  flex: none;
}
.howto__body {
  flex: 1;
}
.howto__title {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}
.howto__desc {
  font-size: 12.5px;
  color: #64748b;
  margin-top: 2px;
}

.ctas {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fafafa;
  border-top: 1px solid #eef2f6;
}
.ctas__btn {
  height: 46px;
}
.ctas__alt {
  margin: 14px auto 0;
  align-self: center;
}
.ctas__error {
  margin: 0 0 4px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff1f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  font-size: 12.5px;
  line-height: 1.5;
}

.footer {
  padding: 16px 20px;
  font-size: 10.5px;
  color: #64748b;
  text-align: center;
  line-height: 1.6;
  border-top: 1px solid #e2e8f0;
  background: #fafafa;
}
.footer__link {
  text-decoration: underline;
  text-decoration-color: #cbd5e1;
}
</style>
