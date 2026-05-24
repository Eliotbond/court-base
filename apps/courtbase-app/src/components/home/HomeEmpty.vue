<script setup lang="ts">
import { useRouter } from 'vue-router'
import { LogOut, ShieldQuestion, UserCog } from 'lucide-vue-next'

import CbEmptyState from '@/components/ui/CbEmptyState.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * Fallback Home — affiché quand l'utilisateur est signed-in mais
 * `auth.roles.length === 0`.
 *
 * Situation théorique post-acceptInvitation qui n'a pas posé de rôle, ou
 * compte créé sans rôle. Le user peut :
 *  - se déconnecter et retenter avec un autre compte,
 *  - ouvrir son profil pour vérifier l'état du compte.
 */

const router = useRouter()
const auth = useAuthStore()

async function onSignOut(): Promise<void> {
  try {
    await auth.signOut()
    router.push({ name: 'sign-in' })
  } catch (err) {
    console.error('[home-empty] signOut failed', err)
  }
}

function openProfile(): void {
  router.push({ name: 'profile-settings' })
}
</script>

<template>
  <CbEmptyState
    :icon="ShieldQuestion"
    title="Compte sans rôle assigné"
    body="Demandez à un admin de votre club de vous attribuer un rôle. Vous pouvez aussi vous déconnecter et essayer un autre compte."
  >
    <template #actions>
      <button class="cb-btn outline sm" type="button" @click="openProfile">
        <UserCog :size="14" />
        Mon profil
      </button>
      <button class="cb-btn primary sm" type="button" @click="onSignOut">
        <LogOut :size="14" />
        Se déconnecter
      </button>
    </template>
  </CbEmptyState>
</template>
