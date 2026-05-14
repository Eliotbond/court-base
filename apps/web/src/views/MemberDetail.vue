<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Mail,
  Pencil,
  Phone,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-vue-next'
import InputText from 'primevue/inputtext'
import Dialog from 'primevue/dialog'
import { useAuthStore } from '@/stores/auth'
import { useMemberDetailStore } from '@/stores/memberDetail'
import { useRoleColors } from '@/composables/useRoleColors'
import Avatar from '@/components/ui/Avatar.vue'
import Pill from '@/components/ui/Pill.vue'
import RoleBadge from '@/components/ui/RoleBadge.vue'
import type { DuesStatus } from '@club-app/shared-types'

const route = useRoute()
const router = useRouter()
const store = useMemberDetailStore()
const auth = useAuthStore()
const { colorsFor, labelFor } = useRoleColors()

// ---------------------------------------------------------------------------
// Lazy-loaded tab components — chacun dans un fichier dédié pour permettre
// l'implémentation en parallèle. Cf. docs/frontend-desktop.md (architecture
// en couches) : chaque tab gère son propre composable + repo.
// ---------------------------------------------------------------------------
const ProfileTab = defineAsyncComponent(
  () => import('@/components/member-detail/ProfileTab.vue'),
)
const DuesTab = defineAsyncComponent(
  () => import('@/components/member-detail/DuesTab.vue'),
)
const AttendanceTab = defineAsyncComponent(
  () => import('@/components/member-detail/AttendanceTab.vue'),
)
const OfficialTab = defineAsyncComponent(
  () => import('@/components/member-detail/OfficialTab.vue'),
)
const RequestsTab = defineAsyncComponent(
  () => import('@/components/member-detail/RequestsTab.vue'),
)

// ---------------------------------------------------------------------------
// Load + cleanup
// ---------------------------------------------------------------------------

const memberId = computed(() => String(route.params.id ?? ''))

onMounted(() => {
  if (memberId.value) void store.load(memberId.value)
})
watch(memberId, (id, prev) => {
  if (id && id !== prev) void store.load(id)
})
onUnmounted(() => {
  store.reset()
})

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'profile' | 'dues' | 'attendance' | 'official' | 'requests'
const activeTab = ref<TabId>('profile')

interface TabDef {
  id: TabId
  label: string
  /** Affiché seulement si la condition est remplie (ex: tab Officiel masqué
   *  si pas official). */
  visible: () => boolean
}

const TABS = computed<readonly TabDef[]>(() => [
  { id: 'profile', label: 'Profil', visible: () => true },
  { id: 'dues', label: 'Cotisations', visible: () => store.isPlayer },
  { id: 'attendance', label: 'Présences', visible: () => store.isPlayer || store.isCoach },
  { id: 'official', label: 'Officiel', visible: () => store.isOfficial },
  { id: 'requests', label: 'Demandes', visible: () => true },
])

const visibleTabs = computed(() => TABS.value.filter((t) => t.visible()))

// Si l'utilisateur quitte le rôle requis pour le tab actif, rebascule sur Profil.
watch(visibleTabs, (tabs) => {
  if (!tabs.find((t) => t.id === activeTab.value)) {
    activeTab.value = 'profile'
  }
})

// ---------------------------------------------------------------------------
// Header helpers — dues pill réutilise la palette de Members.vue.
// ---------------------------------------------------------------------------

type PillVariant = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet'
interface DuesPillDef {
  variant: PillVariant
  label: string
  strike: boolean
}

function duesPill(status: DuesStatus): DuesPillDef {
  switch (status) {
    case 'ok':
      return { variant: 'emerald', label: 'Cotisation à jour', strike: false }
    case 'pending_grace':
      return { variant: 'slate', label: 'Grace period', strike: false }
    case 'due':
      return { variant: 'sky', label: 'Cotisation due', strike: false }
    case 'overdue':
      return { variant: 'rose', label: 'En retard', strike: false }
    case 'excluded':
      return { variant: 'rose', label: 'Exclu', strike: false }
    case 'excepted':
      return { variant: 'amber', label: 'Exception', strike: false }
    case 'n/a':
    default:
      return { variant: 'slate', label: 'n/a', strike: true }
  }
}

// ---------------------------------------------------------------------------
// Edit dialog (profile) — admin only. Le bouton est masqué pour les autres.
// ---------------------------------------------------------------------------

const isEditDialogOpen = ref(false)
const editForm = ref({
  firstName: '',
  lastName: '',
  licenseNumber: '',
})
const editError = ref<string | null>(null)

const isAdmin = computed(() => auth.userDoc?.roles.includes('admin') ?? false)
const canEdit = computed(() => isAdmin.value || auth.rootAdmin)

function openEditDialog(): void {
  if (!store.member) return
  editForm.value = {
    firstName: store.member.firstName,
    lastName: store.member.lastName,
    licenseNumber: store.member.licenseNumber,
  }
  editError.value = null
  isEditDialogOpen.value = true
}

async function submitEdit(): Promise<void> {
  const f = editForm.value
  if (!f.firstName.trim() || !f.lastName.trim()) {
    editError.value = 'Prénom et nom requis.'
    return
  }
  await store.applyProfilePatch({
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    licenseNumber: f.licenseNumber.trim(),
  })
  if (!store.error) {
    isEditDialogOpen.value = false
  }
}

// ---------------------------------------------------------------------------
// Archive / reactivate confirmation
// ---------------------------------------------------------------------------

const isArchiveConfirmOpen = ref(false)

function openArchiveConfirm(): void {
  isArchiveConfirmOpen.value = true
}

async function confirmArchiveOrReactivate(): Promise<void> {
  if (!store.member) return
  if (store.member.active) {
    await store.archive()
  } else {
    await store.reactivate()
  }
  isArchiveConfirmOpen.value = false
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goBack(): void {
  void router.push({ name: 'members' })
}

function goToTeam(teamId: string): void {
  // Pas de route détail team encore — on retourne sur la liste avec un
  // hash pour scroll, à wirer plus tard.
  void router.push({ name: 'teams', hash: `#team-${teamId}` })
}

// Fournit au tab subcomponent les infos utiles (id, member, isAdmin).
// Évite que chaque tab ait à requery `useMemberDetailStore()`.
function tabProps() {
  return {
    memberId: memberId.value,
    member: store.member,
    canEdit: canEdit.value,
  }
}
</script>

<template>
  <section
    v-if="store.loading && !store.member"
    class="p-6"
    aria-busy="true"
  >
    <div class="text-[13px] text-surface-500">
      Chargement du membre…
    </div>
  </section>

  <section
    v-else-if="store.error && !store.member"
    class="p-6"
  >
    <div
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-start gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
        class="mt-0.5"
      />
      <div class="flex-1">
        <div class="font-medium">
          Impossible de charger le membre
        </div>
        <div class="text-[12px] mt-0.5">
          {{ store.error }}
        </div>
      </div>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="goBack"
      >
        Retour
      </button>
    </div>
  </section>

  <section
    v-else-if="!store.member"
    class="p-6"
  >
    <div class="card p-12 flex flex-col items-center text-center gap-3 text-surface-500">
      <CircleAlert
        :size="32"
        :stroke-width="1.5"
        class="text-surface-400"
      />
      <div class="text-[14px] font-medium text-surface-700">
        Ce membre n'existe pas
      </div>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        @click="goBack"
      >
        <ArrowLeft
          :size="14"
          :stroke-width="2"
        />
        Retour à la liste
      </button>
    </div>
  </section>

  <section
    v-else
    class="p-6 space-y-4"
  >
    <!-- ============== Back link ============== -->
    <div>
      <button
        type="button"
        class="btn btn-ghost btn-sm !px-0 !text-surface-500"
        @click="goBack"
      >
        <ArrowLeft
          :size="14"
          :stroke-width="2"
        />
        Members
      </button>
    </div>

    <!-- ============== Header card ============== -->
    <div class="card p-5 flex items-start gap-5 flex-wrap">
      <Avatar
        :name="store.fullName"
        :size="64"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h1
            class="text-[22px] font-semibold tracking-tight"
            :class="store.member.active ? '' : 'line-through text-surface-500'"
          >
            {{ store.fullName }}
          </h1>
          <Pill
            v-if="!store.member.active"
            variant="slate"
          >
            archivé
          </Pill>
        </div>

        <!-- Roles + license + official level -->
        <div class="flex items-center gap-1.5 flex-wrap mt-2">
          <RoleBadge
            v-for="role in store.member.roles"
            :key="role"
            :label="labelFor(role)"
            :bg="colorsFor(role).bg"
            :color="colorsFor(role).fg"
          />
          <Pill
            v-if="store.member.officialLevel !== null"
            variant="emerald"
            class="num"
          >
            L{{ store.member.officialLevel }}
          </Pill>
          <Pill
            v-if="store.member.licensed"
            variant="violet"
          >
            licencié
          </Pill>
          <Pill
            :variant="duesPill(store.member.duesStatus).variant"
            :strike="duesPill(store.member.duesStatus).strike"
          >
            {{ duesPill(store.member.duesStatus).label }}
          </Pill>
        </div>

        <!-- Contact + linkedUser -->
        <div class="flex items-center gap-4 flex-wrap mt-3 text-[12px] text-surface-500">
          <div
            v-if="store.member.email"
            class="flex items-center gap-1"
          >
            <Mail
              :size="13"
              :stroke-width="2"
            />
            <a
              :href="`mailto:${store.member.email}`"
              class="hover:underline"
            >{{ store.member.email }}</a>
          </div>
          <div
            v-if="store.member.phone"
            class="flex items-center gap-1"
          >
            <Phone
              :size="13"
              :stroke-width="2"
            />
            <span>{{ store.member.phone }}</span>
          </div>
          <div
            v-if="store.member.licenseNumber"
            class="font-mono"
          >
            #{{ store.member.licenseNumber }}
          </div>
          <div
            v-if="store.member.linkedUser"
            class="flex items-center gap-1 text-emerald-700"
          >
            <CheckCircle2
              :size="13"
              :stroke-width="2"
            />
            <span>compte lié</span>
          </div>
          <div
            v-else-if="!store.member.linkedUserId"
            class="text-surface-400"
          >
            pas de compte lié
          </div>
        </div>

        <!-- Teams -->
        <div
          v-if="store.member.teams.length > 0"
          class="flex items-center gap-1.5 flex-wrap mt-3"
        >
          <button
            v-for="team in store.member.teams"
            :key="`${team.id}-${team.role}`"
            type="button"
            class="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium bg-surface-100 hover:bg-surface-200 transition-colors"
            @click="goToTeam(team.id)"
          >
            <span class="text-surface-700">{{ team.name }}</span>
            <span class="text-surface-400">·</span>
            <span class="text-surface-500">{{ team.role === 'coach' ? 'coach' : 'joueur' }}</span>
          </button>
        </div>
      </div>

      <!-- Action buttons -->
      <div
        v-if="canEdit"
        class="flex items-center gap-2 shrink-0"
      >
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="store.saving"
          @click="openEditDialog"
        >
          <Pencil
            :size="13"
            :stroke-width="2"
          />
          Modifier
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :class="store.member.active ? '!text-rose-700' : '!text-emerald-700'"
          :disabled="store.saving"
          @click="openArchiveConfirm"
        >
          <component
            :is="store.member.active ? Archive : RotateCcw"
            :size="13"
            :stroke-width="2"
          />
          {{ store.member.active ? 'Archiver' : 'Réactiver' }}
        </button>
      </div>
    </div>

    <!-- ============== Tabs nav ============== -->
    <div class="border-b border-surface-200 flex items-center gap-1">
      <button
        v-for="tab in visibleTabs"
        :key="tab.id"
        type="button"
        class="h-9 px-3 text-[13px] border-b-2 transition-colors"
        :class="
          activeTab === tab.id
            ? 'border-primary-600 text-primary-700 font-semibold'
            : 'border-transparent text-surface-500 hover:text-surface-700'
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ============== Tab content ============== -->
    <ProfileTab
      v-if="activeTab === 'profile'"
      v-bind="tabProps()"
    />
    <DuesTab
      v-else-if="activeTab === 'dues'"
      v-bind="tabProps()"
    />
    <AttendanceTab
      v-else-if="activeTab === 'attendance'"
      v-bind="tabProps()"
    />
    <OfficialTab
      v-else-if="activeTab === 'official'"
      v-bind="tabProps()"
    />
    <RequestsTab
      v-else-if="activeTab === 'requests'"
      v-bind="tabProps()"
    />

    <!-- ============== Error toast (mutation) ============== -->
    <div
      v-if="store.error && store.member"
      class="card border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 flex items-center gap-2"
    >
      <TriangleAlert
        :size="14"
        :stroke-width="2"
      />
      {{ store.error }}
      <button
        type="button"
        class="ml-auto btn btn-ghost btn-sm !text-rose-700"
        @click="store.error = null"
      >
        <X
          :size="14"
          :stroke-width="2"
        />
      </button>
    </div>

    <!-- ============== Edit dialog ============== -->
    <Dialog
      v-model:visible="isEditDialogOpen"
      modal
      :draggable="false"
      :style="{ width: '480px' }"
      header="Modifier le membre"
    >
      <div class="space-y-3 pt-1">
        <label class="block">
          <span class="text-[12px] text-surface-600">Prénom</span>
          <InputText
            v-model="editForm.firstName"
            class="mt-1 w-full"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">Nom</span>
          <InputText
            v-model="editForm.lastName"
            class="mt-1 w-full"
          />
        </label>
        <label class="block">
          <span class="text-[12px] text-surface-600">N° de licence</span>
          <InputText
            v-model="editForm.licenseNumber"
            class="mt-1 w-full"
            placeholder="ex. CH-12345"
          />
        </label>
        <p
          v-if="editError"
          class="text-[12px] text-rose-600"
        >
          {{ editError }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="isEditDialogOpen = false"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="store.saving"
          @click="submitEdit"
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

    <!-- ============== Archive confirm dialog ============== -->
    <Dialog
      v-model:visible="isArchiveConfirmOpen"
      modal
      :draggable="false"
      :style="{ width: '420px' }"
      :header="store.member.active ? 'Archiver le membre' : 'Réactiver le membre'"
    >
      <div class="space-y-2 pt-1 text-[13px]">
        <template v-if="store.member.active">
          <p>
            Archiver <strong>{{ store.fullName }}</strong> ? Le membre restera
            visible dans l'historique mais sera marqué inactif.
          </p>
          <p class="text-[12px] text-surface-500">
            Pas de cascade : les cotisations / présences / assignations existantes
            sont conservées. Pour retirer le membre des équipes, fais-le manuellement
            depuis la page Teams.
          </p>
        </template>
        <template v-else>
          <p>
            Réactiver <strong>{{ store.fullName }}</strong> ?
          </p>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          @click="isArchiveConfirmOpen = false"
        >
          Annuler
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="store.member.active ? 'btn-primary !bg-rose-600 hover:!bg-rose-700' : 'btn-primary'"
          :disabled="store.saving"
          @click="confirmArchiveOrReactivate"
        >
          <template v-if="store.saving">
            …
          </template>
          <template v-else>
            {{ store.member.active ? 'Archiver' : 'Réactiver' }}
          </template>
        </button>
      </template>
    </Dialog>
  </section>
</template>
