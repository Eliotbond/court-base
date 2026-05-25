<script setup lang="ts">
/**
 * Settings → Admin team.
 *
 * Liste les utilisateurs portant le rôle `admin` sur ce club + invitations en
 * attente. Permet à un admin / rootAdmin de :
 *   - inviter un nouvel admin (par email — provisionné via `acceptInvitation`
 *     après sign-in OAuth)
 *   - gérer les rôles cumulables d'un admin existant (coach, official, treasurer)
 *   - retirer un admin (sauf rootAdmin, non-révocable via l'UI)
 *   - annuler une invitation pending
 *
 * Architecture : aucune lecture/écriture Firestore directe — tout passe par
 * `useSettingsStore` (cf. `docs/frontend-desktop.md` §architecture en couches).
 *
 * Extrait depuis l'ancien `Settings.vue` monolithique (script lignes 715-870,
 * template 4260-4467, dialogs 4472-4660). Le wrapper
 * `v-if="activeSection === 'adminTeam'"` a été supprimé : la vue n'est rendue
 * que lorsque la route `/settings/admin-team` est active.
 */

import { onMounted, ref } from 'vue'
import {
  Check,
  CircleAlert,
  Crown,
  Mail,
  Plus,
  Send,
  TriangleAlert,
} from 'lucide-vue-next'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import { useSettingsStore } from '@/stores/settings'

const store = useSettingsStore()

onMounted(() => {
  void store.load()
})

// ---------------------------------------------------------------------------
// Saved banner helpers (per-section) — version locale puisque cette vue ne
// porte qu'une section (`adminTeam`).
// ---------------------------------------------------------------------------

function isSavingAdminTeam(): boolean {
  return store.savingSection === 'adminTeam'
}

function isSavedAdminTeam(): boolean {
  return store.lastSaved === 'adminTeam'
}

// ---------------------------------------------------------------------------
// Admin team — invite dialog + remove action.
// ---------------------------------------------------------------------------

const isInviteDialogOpen = ref(false)
const inviteForm = ref({ email: '' })
const inviteError = ref<string | null>(null)

function openInviteDialog(): void {
  inviteForm.value = { email: '' }
  inviteError.value = null
  isInviteDialogOpen.value = true
}

function closeInviteDialog(): void {
  isInviteDialogOpen.value = false
  inviteError.value = null
}

function validateInvite(): boolean {
  const email = inviteForm.value.email.trim()
  if (!email) {
    inviteError.value = 'Email requis'
    return false
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    inviteError.value = 'Email invalide'
    return false
  }
  inviteError.value = null
  return true
}

async function submitInvite(): Promise<void> {
  if (!validateInvite()) return
  try {
    await store.inviteAdminAction({ email: inviteForm.value.email.trim() })
    closeInviteDialog()
  } catch {
    /* surfaced via store.error */
  }
}

async function confirmRemoveAdmin(uid: string, name: string): Promise<void> {
  const ok = window.confirm(
    `Retirer ${name} de l'équipe admin ? L'utilisateur perdra l'accès admin (mais conservera ses autres rôles).`,
  )
  if (!ok) return
  try {
    await store.removeAdminAction(uid)
  } catch {
    /* surfaced */
  }
}

async function confirmCancelInvitation(id: string, email: string): Promise<void> {
  const ok = window.confirm(
    `Annuler l'invitation de ${email} ? Le lien de sign-in ne fonctionnera plus.`,
  )
  if (!ok) return
  try {
    await store.cancelInvitationAction(id)
  } catch {
    /* surfaced */
  }
}

// ---------------------------------------------------------------------------
// Manage roles dialog (admin team) — gestion cumulative des rôles app sur
// un user existant. `admin` est forcé présent (la révocation passe par
// "Retirer", qui appellera la callable dédiée à terme).
//
// Rôles app gérables ici (cf. docs/firebase.md /users.roles) :
//   - `admin`      : accès complet admin (immuable depuis cette UI)
//   - `coach`      : scope coach via /users.teamIds
//   - `official`   : capacité officiel (lié à /members.officialLevel côté métier)
//   - `treasurer`  : marque les cotisations comme payées (callable serveur
//                    `markDuePaid` ; wrapper TS : `markCotisationPaid`) ET
//                    peut enregistrer un montant partiel (arrangement comité
//                    in extremis) — capability réservée à `rootAdmin` /
//                    `treasurer`, cf. `assertCanRecordPartial` côté Function.
//
// Volontairement absents : `player`, `parent` — gérés par d'autres flows
// (création membre, ajout tuteur).
// ---------------------------------------------------------------------------

interface RolesDialogState {
  uid: string
  displayName: string
  email: string
  admin: boolean
  coach: boolean
  official: boolean
  treasurer: boolean
  /** Autres rôles préservés à la sauvegarde (ex. `'parent'`, `'player'`). */
  preservedRoles: string[]
}

const rolesDialogOpen = ref(false)
const rolesDialogTarget = ref<RolesDialogState | null>(null)
const rolesDialogError = ref<string | null>(null)

const MANAGED_ROLES = ['admin', 'coach', 'official', 'treasurer'] as const
type ManagedRole = (typeof MANAGED_ROLES)[number]

function openRolesDialog(admin: {
  id: string
  displayName: string
  email: string
  roles: string[]
}): void {
  const has = (r: ManagedRole): boolean => admin.roles.includes(r)
  const preserved = admin.roles.filter(
    (r) => !MANAGED_ROLES.includes(r as ManagedRole),
  )
  rolesDialogTarget.value = {
    uid: admin.id,
    displayName: admin.displayName,
    email: admin.email,
    admin: true, // toujours forcé true depuis cette UI
    coach: has('coach'),
    official: has('official'),
    treasurer: has('treasurer'),
    preservedRoles: preserved,
  }
  rolesDialogError.value = null
  rolesDialogOpen.value = true
}

function closeRolesDialog(): void {
  rolesDialogOpen.value = false
  rolesDialogTarget.value = null
  rolesDialogError.value = null
}

async function submitRolesDialog(): Promise<void> {
  const target = rolesDialogTarget.value
  if (!target) return
  const next: string[] = []
  // `admin` toujours présent — on ne propose pas la révocation via cette UI.
  next.push('admin')
  if (target.coach) next.push('coach')
  if (target.official) next.push('official')
  if (target.treasurer) next.push('treasurer')
  // Préserve les rôles non gérés ici (parent, player, futurs ajouts).
  for (const r of target.preservedRoles) {
    if (!next.includes(r)) next.push(r)
  }
  rolesDialogError.value = null
  try {
    await store.updateAdminRoles(target.uid, next)
    closeRolesDialog()
  } catch (e: unknown) {
    rolesDialogError.value =
      e instanceof Error ? e.message : 'Erreur lors de la mise à jour des rôles'
  }
}
</script>

<template>
  <section class="p-6 space-y-6">
    <!-- ================= Page heading =================== -->
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-[22px] font-semibold tracking-tight">
          Équipe admin
        </h1>
        <p class="text-[13px] text-surface-500 mt-0.5">
          Utilisateurs portant le rôle <code class="font-mono text-[11px]">admin</code>
          sur ce club (cf. <code class="font-mono text-[11px]">/users.roles</code>
          dans firebase.md). Le <strong>rootAdmin</strong> est non-révocable via l'UI.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        :disabled="isSavingAdminTeam()"
        @click="openInviteDialog"
      >
        <Plus
          :size="14"
          :stroke-width="2"
        />
        Inviter un admin
      </button>
    </div>

    <!-- Bannière "invitation enregistrée" -->
    <div
      v-if="store.lastInvitedEmail"
      class="border border-sky-200 bg-sky-50/60 rounded-md px-3 py-2.5 flex items-center gap-2 text-[12px] text-sky-800"
    >
      <Mail
        :size="14"
        :stroke-width="2"
      />
      <span>
        Invitation créée pour <strong>{{ store.lastInvitedEmail }}</strong>.
        Demande-lui de se connecter via Google avec cet email — son compte
        admin sera provisionné automatiquement.
      </span>
    </div>

    <!-- Admins list -->
    <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
      <div
        v-for="admin in store.admins"
        :key="admin.id"
        class="flex items-center gap-3 px-3 h-14"
      >
        <Avatar
          :name="admin.displayName"
          :size="32"
        />
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-[13px] truncate">
              {{ admin.displayName }}
            </span>
            <Pill
              v-if="admin.isRootAdmin"
              variant="amber"
            >
              <Crown
                :size="11"
                :stroke-width="2"
              />
              rootAdmin
            </Pill>
            <Pill
              v-if="admin.roles.includes('admin')"
              variant="rose"
            >
              admin
            </Pill>
            <Pill
              v-if="admin.roles.includes('coach')"
              variant="sky"
            >
              coach
            </Pill>
            <Pill
              v-if="admin.roles.includes('official')"
              variant="emerald"
            >
              official
            </Pill>
            <Pill
              v-if="admin.roles.includes('treasurer')"
              variant="violet"
            >
              treasurer
            </Pill>
          </div>
          <span class="text-[11px] text-surface-500 truncate">
            {{ admin.email }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="isSavingAdminTeam()"
            title="Gérer les rôles (admin / coach / official / treasurer)"
            @click="openRolesDialog(admin)"
          >
            Rôles
          </button>
          <button
            v-if="admin.isRootAdmin"
            type="button"
            class="btn btn-ghost btn-sm !text-surface-400 cursor-not-allowed"
            disabled
            title="Root admin · ne peut être révoqué via l'UI"
          >
            Retirer
          </button>
          <button
            v-else
            type="button"
            class="btn btn-ghost btn-sm !text-rose-700"
            :disabled="isSavingAdminTeam()"
            @click="confirmRemoveAdmin(admin.id, admin.displayName)"
          >
            Retirer
          </button>
        </div>
      </div>

      <template v-if="store.admins.length === 0">
        <div class="px-3 py-6 text-center text-[12px] text-surface-500">
          Aucun admin (autre que rootAdmin).
        </div>
      </template>
    </div>

    <!-- Pending invitations (sous la liste admins) -->
    <template v-if="store.invitations.length > 0">
      <h3 class="text-[14px] font-semibold mt-4">
        Invitations en attente
      </h3>
      <div class="border border-surface-200 rounded-md divide-y divide-surface-200">
        <div
          v-for="invite in store.invitations"
          :key="invite.id"
          class="flex items-center gap-3 px-3 h-14"
        >
          <div
            class="w-8 h-8 rounded-full bg-surface-100 text-surface-400 flex items-center justify-center"
          >
            <Mail
              :size="14"
              :stroke-width="2"
            />
          </div>
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-[13px] truncate">
                {{ invite.email }}
              </span>
              <Pill variant="sky">
                pending
              </Pill>
              <Pill variant="rose">
                {{ invite.role }}
              </Pill>
            </div>
            <span class="text-[11px] text-surface-500 truncate">
              Invité par {{ invite.invitedByName }}
            </span>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm !text-rose-700"
              :disabled="isSavingAdminTeam()"
              @click="confirmCancelInvitation(invite.id, invite.email)"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    </template>

    <div class="text-[11px] text-surface-500 flex items-center gap-1.5">
      <CircleAlert
        :size="12"
        :stroke-width="2"
      />
      <!-- TODO(security): refuse self-demote / last-admin via callable -->
      <span>
        "Retirer" est actuellement un stub côté repo (la callable
        <code class="font-mono text-[11px]">removeAdmin</code> avec garde anti
        last-admin / self-demote sera wired dans un chantier dédié).
      </span>
    </div>

    <div
      v-if="isSavedAdminTeam()"
      class="text-[12px] text-emerald-700 flex items-center gap-1"
    >
      <Check
        :size="14"
        :stroke-width="2"
      />
      Admin team mise à jour
    </div>

    <!-- =================== Invite admin dialog =================== -->
    <Dialog
      v-model:visible="isInviteDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '420px' }"
      header="Inviter un admin"
    >
      <div class="space-y-3 pt-1">
        <p class="text-[12px] text-surface-500">
          L'invité recevra un email d'invitation. À son acceptation, un compte
          Auth sera créé avec le rôle <code class="font-mono text-[11px]">admin</code>
          (cf. <code class="font-mono text-[11px]">/users.roles</code>).
        </p>
        <label class="block">
          <span class="text-[12px] text-surface-600">Email</span>
          <InputText
            v-model="inviteForm.email"
            class="mt-1 w-full"
            placeholder="prenom.nom@club.ch"
            :invalid="!!inviteError"
            @keyup.enter="submitInvite"
          />
          <span
            v-if="inviteError"
            class="text-[11px] text-rose-600 mt-1 block"
          >
            {{ inviteError }}
          </span>
        </label>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeInviteDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingAdminTeam()"
          @click="submitInvite"
        >
          <Send
            :size="14"
            :stroke-width="2"
          />
          <template v-if="isSavingAdminTeam()">
            Envoi…
          </template>
          <template v-else>
            Envoyer l'invitation
          </template>
        </button>
      </template>
    </Dialog>

    <!-- =================== Manage roles dialog =================== -->
    <Dialog
      v-model:visible="rolesDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '460px' }"
      header="Gérer les rôles"
    >
      <div
        v-if="rolesDialogTarget"
        class="space-y-3 pt-1"
      >
        <div class="flex items-center gap-2 text-[13px]">
          <Avatar
            :name="rolesDialogTarget.displayName"
            :size="28"
          />
          <div class="flex flex-col min-w-0">
            <span class="font-medium truncate">
              {{ rolesDialogTarget.displayName }}
            </span>
            <span class="text-[11px] text-surface-500 truncate">
              {{ rolesDialogTarget.email }}
            </span>
          </div>
        </div>

        <p class="text-[12px] text-surface-500">
          Les rôles sont cumulables (cf.
          <code class="font-mono text-[11px]">/users.roles</code>). `admin`
          est verrouillé ici — la révocation passe par "Retirer".
        </p>

        <div class="space-y-2">
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              :model-value="true"
              :binary="true"
              disabled
            />
            <div class="flex-1">
              <div class="font-medium">
                admin
              </div>
              <div class="text-[11px] text-surface-500">
                Accès complet à toute l'app (verrouillé depuis cette UI).
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.coach"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                coach
              </div>
              <div class="text-[11px] text-surface-500">
                Scope coach via <code class="font-mono text-[10px]">/users.teamIds</code>.
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.official"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                official
              </div>
              <div class="text-[11px] text-surface-500">
                Capacité officiel app (lié à <code class="font-mono text-[10px]">/members.officialLevel</code> côté métier).
              </div>
            </div>
          </label>
          <label class="flex items-start gap-2 text-[13px]">
            <Checkbox
              v-model="rolesDialogTarget.treasurer"
              :binary="true"
            />
            <div class="flex-1">
              <div class="font-medium">
                treasurer
              </div>
              <div class="text-[11px] text-surface-500">
                Marque les cotisations comme payées. <strong>Capability comité</strong>&nbsp;:
                peut aussi enregistrer un <strong>montant partiel</strong>
                (arrangement in extremis) — réservée à <code class="font-mono text-[10px]">rootAdmin</code>
                et <code class="font-mono text-[10px]">treasurer</code>.
              </div>
            </div>
          </label>
        </div>

        <div
          v-if="rolesDialogError"
          class="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-2 flex items-center gap-2"
        >
          <TriangleAlert
            :size="13"
            :stroke-width="2"
          />
          {{ rolesDialogError }}
        </div>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="closeRolesDialog"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="isSavingAdminTeam()"
          @click="submitRolesDialog"
        >
          <template v-if="isSavingAdminTeam()">
            Sauvegarde…
          </template>
          <template v-else>
            Enregistrer
          </template>
        </button>
      </template>
    </Dialog>
  </section>
</template>
