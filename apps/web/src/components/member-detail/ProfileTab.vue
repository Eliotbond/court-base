<script setup lang="ts">
import { ref } from 'vue'
import { Mail, Pencil, Phone } from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Dialog from 'primevue/dialog'
import { useMemberDetailStore } from '@/stores/memberDetail'
import type { MemberDetailRow } from '@/repositories/members.repo'

defineProps<{
  memberId: string
  member: MemberDetailRow | null
  canEdit: boolean
}>()

const store = useMemberDetailStore()

// ---------------------------------------------------------------------------
// Contact edit dialog — admin OR member self.
// ---------------------------------------------------------------------------
const isContactDialogOpen = ref(false)
const contactForm = ref({ email: '', phone: '' })

function openContactDialog(): void {
  if (!store.member) return
  contactForm.value = {
    email: store.member.email ?? '',
    phone: store.member.phone ?? '',
  }
  isContactDialogOpen.value = true
}

async function submitContact(): Promise<void> {
  await store.applyContactPatch({
    email: contactForm.value.email.trim(),
    phone: contactForm.value.phone.trim(),
  })
  if (!store.error) {
    isContactDialogOpen.value = false
  }
}
</script>

<template>
  <div
    v-if="store.member"
    class="grid gap-4 md:grid-cols-2"
  >
    <!-- ============== Identité ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold">
          Identité
        </h2>
      </div>
      <dl class="text-[13px] space-y-2">
        <div class="flex">
          <dt class="w-32 text-surface-500">
            Prénom
          </dt>
          <dd>{{ store.member.firstName }}</dd>
        </div>
        <div class="flex">
          <dt class="w-32 text-surface-500">
            Nom
          </dt>
          <dd>{{ store.member.lastName }}</dd>
        </div>
        <div class="flex">
          <dt class="w-32 text-surface-500">
            N° de licence
          </dt>
          <dd class="font-mono">
            {{ store.member.licenseNumber || '—' }}
          </dd>
        </div>
        <div class="flex">
          <dt class="w-32 text-surface-500">
            Statut
          </dt>
          <dd>{{ store.member.active ? 'Actif' : 'Archivé' }}</dd>
        </div>
      </dl>
    </div>

    <!-- ============== Contact ============== -->
    <div class="card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-[14px] font-semibold">
          Contact
        </h2>
        <button
          v-if="canEdit"
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="store.saving"
          @click="openContactDialog"
        >
          <Pencil
            :size="12"
            :stroke-width="2"
          />
          Modifier
        </button>
      </div>
      <dl class="text-[13px] space-y-2">
        <div class="flex items-center">
          <dt class="w-32 text-surface-500 flex items-center gap-1">
            <Mail
              :size="12"
              :stroke-width="2"
            />
            Email
          </dt>
          <dd v-if="store.member.email">
            <a
              :href="`mailto:${store.member.email}`"
              class="hover:underline"
            >
              {{ store.member.email }}
            </a>
          </dd>
          <dd
            v-else
            class="text-surface-400"
          >
            —
          </dd>
        </div>
        <div class="flex items-center">
          <dt class="w-32 text-surface-500 flex items-center gap-1">
            <Phone
              :size="12"
              :stroke-width="2"
            />
            Téléphone
          </dt>
          <dd v-if="store.member.phone">
            {{ store.member.phone }}
          </dd>
          <dd
            v-else
            class="text-surface-400"
          >
            —
          </dd>
        </div>
      </dl>
    </div>

    <!-- ============== Rôles ============== -->
    <div class="card p-5 space-y-3">
      <h2 class="text-[14px] font-semibold">
        Rôles club
      </h2>
      <p class="text-[12px] text-surface-500">
        Les rôles sont cumulables (cf. <code class="font-mono text-[11px]">/members.roles</code>).
        L'édition complète (ajout / retrait, niveau official, licence) sera
        wired dans un drawer dédié.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="role in store.member.roles"
          :key="role"
          class="inline-flex h-6 px-2 rounded text-[11px] font-medium bg-surface-100 text-surface-700"
        >
          {{ role }}
        </span>
        <span
          v-if="store.member.roles.length === 0"
          class="text-surface-400 text-[12px]"
        >
          aucun rôle assigné
        </span>
      </div>
    </div>

    <!-- ============== Compte Auth ============== -->
    <div class="card p-5 space-y-3">
      <h2 class="text-[14px] font-semibold">
        Compte Firebase Auth
      </h2>
      <template v-if="store.member.linkedUser">
        <dl class="text-[13px] space-y-2">
          <div class="flex">
            <dt class="w-32 text-surface-500">
              Display name
            </dt>
            <dd>{{ store.member.linkedUser.displayName || '—' }}</dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500">
              Email
            </dt>
            <dd>{{ store.member.linkedUser.email || '—' }}</dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500">
              Rôles auth
            </dt>
            <dd class="flex flex-wrap gap-1">
              <span
                v-for="role in store.member.linkedUser.roles"
                :key="role"
                class="inline-flex h-5 px-1.5 rounded text-[11px] bg-surface-100 text-surface-700"
              >
                {{ role }}
              </span>
              <span
                v-if="store.member.linkedUser.roles.length === 0"
                class="text-surface-400 text-[12px]"
              >—</span>
            </dd>
          </div>
          <div class="flex">
            <dt class="w-32 text-surface-500">
              uid
            </dt>
            <dd class="font-mono text-[11px] text-surface-500 truncate">
              {{ store.member.linkedUser.id }}
            </dd>
          </div>
        </dl>
      </template>
      <template v-else-if="store.member.linkedUserId">
        <p class="text-[12px] text-amber-700">
          Lié à un user (uid <code class="font-mono">{{ store.member.linkedUserId }}</code>)
          mais le document <code class="font-mono">/users/{uid}</code> est inaccessible ou absent.
        </p>
      </template>
      <template v-else>
        <p class="text-[12px] text-surface-500">
          Ce membre n'a pas de compte Firebase Auth lié.
        </p>
      </template>
    </div>
  </div>

  <!-- ============== Contact dialog ============== -->
  <Dialog
    v-model:visible="isContactDialogOpen"
    modal
    :draggable="false"
    :style="{ width: '420px' }"
    header="Modifier le contact"
  >
    <div class="space-y-3 pt-1">
      <label class="block">
        <span class="text-[12px] text-surface-600">Email</span>
        <InputText
          v-model="contactForm.email"
          class="mt-1 w-full"
          placeholder="prenom.nom@club.ch"
        />
      </label>
      <label class="block">
        <span class="text-[12px] text-surface-600">Téléphone</span>
        <InputText
          v-model="contactForm.phone"
          class="mt-1 w-full"
          placeholder="+41 ..."
        />
      </label>
    </div>
    <template #footer>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="isContactDialogOpen = false"
      >
        Annuler
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="store.saving"
        @click="submitContact"
      >
        <template v-if="store.saving">
          Enregistrement…
        </template>
        <template v-else>
          Enregistrer
        </template>
      </button>
    </template>
  </Dialog>
</template>
