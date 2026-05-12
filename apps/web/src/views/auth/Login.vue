<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Divider from 'primevue/divider'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Password from 'primevue/password'
import { NotAuthorizedError } from '@/repositories/users.repo'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)

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
      return 'Ce fournisseur n’est pas activé pour ce projet.'
    case 'auth/unauthorized-domain':
      return 'Ce domaine n’est pas autorisé pour cette connexion.'
    default:
      return 'Échec de la connexion. Réessayez.'
  }
}

function handleError(e: unknown) {
  if (e instanceof NotAuthorizedError) {
    error.value = 'Compte non autorisé. Demandez à votre admin de vous inviter.'
    return
  }
  if (e instanceof FirebaseError) {
    error.value = messageFor(e.code)
    return
  }
  error.value = 'Échec de la connexion. Réessayez.'
}

async function redirectAfterSignIn() {
  const redirect = route.query.redirect
  const target = typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/'
  await router.replace(target)
}

async function onSubmit() {
  error.value = null
  try {
    await auth.signIn(email.value, password.value)
    await redirectAfterSignIn()
  } catch (e) {
    handleError(e)
  }
}

async function onGoogle() {
  error.value = null
  try {
    await auth.signInWithGoogle()
    await redirectAfterSignIn()
  } catch (e) {
    handleError(e)
  }
}

async function onApple() {
  error.value = null
  try {
    await auth.signInWithApple()
    await redirectAfterSignIn()
  } catch (e) {
    handleError(e)
  }
}
</script>

<template>
  <main class="login">
    <Card class="login__card">
      <template #title>
        Connexion
      </template>
      <template #content>
        <div class="login__providers">
          <Button
            type="button"
            label="Continuer avec Google"
            icon="pi pi-google"
            severity="secondary"
            outlined
            :loading="auth.loading"
            :disabled="auth.loading"
            class="login__provider"
            @click="onGoogle"
          />
          <Button
            type="button"
            label="Continuer avec Apple"
            icon="pi pi-apple"
            severity="secondary"
            outlined
            :loading="auth.loading"
            :disabled="auth.loading"
            class="login__provider"
            @click="onApple"
          />
        </div>

        <Divider align="center">
          <span class="login__divider-text">ou</span>
        </Divider>

        <form
          class="login__form"
          @submit.prevent="onSubmit"
        >
          <div class="login__field">
            <label for="email">Email</label>
            <InputText
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              :disabled="auth.loading"
            />
          </div>
          <div class="login__field">
            <label for="password">Mot de passe</label>
            <Password
              v-model="password"
              input-id="password"
              :feedback="false"
              toggle-mask
              autocomplete="current-password"
              required
              :disabled="auth.loading"
              :input-props="{ required: true }"
            />
          </div>

          <Message
            v-if="error"
            severity="error"
            :closable="false"
          >
            {{ error }}
          </Message>

          <Button
            type="submit"
            label="Se connecter"
            icon="pi pi-sign-in"
            :loading="auth.loading"
            class="login__submit"
          />
        </form>
      </template>
    </Card>
  </main>
</template>

<style scoped>
.login {
  max-width: 420px;
  margin: 4rem auto;
  padding: 1rem;
}
.login__card {
  width: 100%;
}
.login__providers {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.login__provider {
  width: 100%;
  justify-content: center;
}
.login__divider-text {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color, #888);
}
.login__form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.login__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.login__field label {
  font-size: 0.875rem;
  font-weight: 500;
}
.login__field :deep(.p-password),
.login__field :deep(.p-password input) {
  width: 100%;
}
.login__submit {
  align-self: flex-end;
}
</style>
