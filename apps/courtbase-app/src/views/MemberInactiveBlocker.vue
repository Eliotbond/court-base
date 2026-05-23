<script setup lang="ts">
import { XCircle } from 'lucide-vue-next'
import CbMobileShell from '@/components/ui/CbMobileShell.vue'

/**
 * S11 — Blocker plein écran affiché quand `linkedMember.active === false`.
 * Cf. `docs/main.md` § "Membre actif / inactif" — la défense en profondeur
 * réelle est dans `firestore.rules` (helper `callerSuspended()`), cette page
 * est l'UX qui explique au user pourquoi il ne voit rien.
 */
</script>

<template>
  <CbMobileShell hide-header plain-body>
    <div class="cb-page" style="padding: 80px 24px; align-items: center; text-align: center; gap: 20px">
      <div
        class="cb-avatar lg rose"
        style="background: var(--rose-100); color: var(--rose-700); border-radius: 28px"
      >
        <XCircle :size="32" />
      </div>
      <div>
        <h1 class="cb-h1">Votre compte est inactif</h1>
        <p class="cb-sub" style="margin-top: 10px; max-width: 320px">
          Contactez l'administration de votre club ou réinscrivez-vous via le portail.
        </p>
      </div>
      <div style="width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 8px">
        <button class="cb-btn primary block">Ouvrir le portail d'inscription</button>
        <button class="cb-btn ghost block">Se déconnecter</button>
      </div>
    </div>
  </CbMobileShell>
</template>
