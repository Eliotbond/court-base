import { ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'
import {
  cancelInvitation,
  createClosurePeriod,
  createRole,
  deleteClosurePeriod,
  deleteClubLogoByUrl,
  deleteRole,
  getClubConfig,
  getSubscriptionInfo,
  inviteAdmin,
  listAdmins,
  listClosurePeriods,
  listInvitations,
  listRoles,
  removeAdmin,
  updateClubConfig,
  updateRole,
  updateUserRoles,
  uploadClubLogo,
  type AdminInviteInput,
  type ClosurePeriodInput,
  type ClubAdmin,
  type ClubConfigPatch,
  type RoleInput,
} from '@/repositories/settings.repo'
import type {
  BankingInfo,
  ClosurePeriod,
  ClubConfig,
  DuesConfig,
  Invitation,
  OfficialsConfig,
  Role,
  SubscriptionInfo,
} from '@club-app/shared-types'

/**
 * Identifiants de section — utilisés pour piloter le flag `savingSection` et
 * les flags d'erreur granulaires. Aligné sur les onglets verticaux du design
 * (Mockups screen #16) — la section `adminTeam` est ajoutée pour le
 * sous-écran "Admin team" (cf. design bundle).
 */
export type SettingsSection =
  | 'general'
  | 'banking'
  | 'officials'
  | 'dues'
  | 'roles'
  | 'categories'
  | 'tags'
  | 'cotisations'
  | 'licenses'
  | 'matchTypes'
  | 'closurePeriods'
  | 'adminTeam'

/**
 * Source unique des données de l'écran Settings.
 *
 * `load()` batche les lectures en parallèle. Les actions de mutation sont
 * optimistes : on update le state local d'abord, on appelle le repo, et on
 * rollback si le repo throw (rollback geré par snapshot).
 *
 * Voir docs/frontend-desktop.md (architecture en couches) : la vue lit/écrit
 * via ce store, jamais le repo directement.
 */
export const useSettingsStore = defineStore('settings', () => {
  // ---------------------- State ----------------------
  const config = ref<ClubConfig | null>(null)
  const subscription = ref<SubscriptionInfo | null>(null)
  const roles = ref<Role[]>([])
  const closurePeriods = ref<ClosurePeriod[]>([])
  const admins = ref<ClubAdmin[]>([])
  const invitations = ref<Invitation[]>([])

  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Section en cours de sauvegarde — null si idle. */
  const savingSection = ref<SettingsSection | null>(null)
  /** Section dernière success — l'UI peut afficher un toast/banner inline. */
  const lastSaved = ref<SettingsSection | null>(null)

  // ---------------------- Actions ----------------------

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [cfg, sub, rs, cps, adm, invs] = await Promise.all([
        getClubConfig(),
        getSubscriptionInfo(),
        listRoles(),
        listClosurePeriods(),
        listAdmins(),
        listInvitations(),
      ])
      config.value = cfg
      subscription.value = sub
      roles.value = rs
      closurePeriods.value = cps
      admins.value = adm
      invitations.value = invs
    } catch (e: unknown) {
      error.value =
        e instanceof Error ? e.message : 'Erreur de chargement des paramètres'
    } finally {
      loading.value = false
    }
  }

  function markSaved(section: SettingsSection): void {
    lastSaved.value = section
    // Reset après 3s pour permettre à la bannière "saved" de disparaître.
    window.setTimeout(() => {
      if (lastSaved.value === section) lastSaved.value = null
    }, 3000)
  }

  function setError(message: string): void {
    error.value = message
  }

  // -----------------------------------------------------
  // General (identité club + shortCode + contact + subscription read-only)
  // -----------------------------------------------------

  /**
   * Patch identité club (name, shortCode, address, contact, logo). Tout
   * vit dans `/config/club` (cf. `docs/firebase.md`), donc un seul appel
   * repo.
   */
  async function saveClubInfo(patch: ClubConfigPatch): Promise<void> {
    if (!config.value) {
      throw new Error('Settings non chargés — appelez load() avant')
    }
    savingSection.value = 'general'
    const snap: ClubConfig = JSON.parse(JSON.stringify(config.value)) as ClubConfig
    // Optimistic apply.
    if (patch.name !== undefined) config.value.name = patch.name
    if (patch.shortCode !== undefined) config.value.shortCode = patch.shortCode
    if (patch.logo !== undefined) config.value.logo = patch.logo
    if (patch.address !== undefined) config.value.address = patch.address
    if (patch.contact !== undefined) {
      config.value.contact = { ...config.value.contact, ...patch.contact }
    }
    try {
      await updateClubConfig(patch)
      markSaved('general')
    } catch (e: unknown) {
      // Rollback.
      config.value = snap
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  /**
   * Upload un nouveau logo dans Storage puis persiste l'URL dans
   * `/config/club.logo`. Si un logo existe déjà, l'ancien fichier est
   * supprimé après le commit Firestore (best-effort — l'erreur de suppression
   * n'invalide pas l'opération).
   */
  async function setLogo(file: File): Promise<void> {
    if (!config.value) throw new Error('Settings non chargés')
    savingSection.value = 'general'
    const previousLogo = config.value.logo
    try {
      const url = await uploadClubLogo(file)
      await updateClubConfig({ logo: url })
      config.value.logo = url
      // Best-effort cleanup de l'ancien logo (ne propage pas l'erreur).
      if (previousLogo) {
        deleteClubLogoByUrl(previousLogo).catch((err: unknown) => {
          const code = err instanceof FirebaseError ? err.code : 'unknown'
          console.warn(`cleanup previous logo failed [${code}]`, err)
        })
      }
      markSaved('general')
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`setLogo failed [${code}]`, e)
      setError(e instanceof Error ? e.message : "Erreur lors de l'upload du logo")
      throw e
    } finally {
      savingSection.value = null
    }
  }

  /**
   * Supprime le logo : reset `/config/club.logo` à `null` puis efface le
   * fichier dans Storage (best-effort).
   */
  async function removeLogo(): Promise<void> {
    if (!config.value) throw new Error('Settings non chargés')
    if (!config.value.logo) return
    savingSection.value = 'general'
    const previousLogo = config.value.logo
    try {
      await updateClubConfig({ logo: null })
      config.value.logo = null
      deleteClubLogoByUrl(previousLogo).catch((err: unknown) => {
        const code = err instanceof FirebaseError ? err.code : 'unknown'
        console.warn(`delete logo file failed [${code}]`, err)
      })
      markSaved('general')
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : 'unknown'
      console.error(`removeLogo failed [${code}]`, e)
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression du logo')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Officials config
  // -----------------------------------------------------

  async function saveOfficialsConfig(patch: OfficialsConfig): Promise<void> {
    if (!config.value) throw new Error('Settings non chargés')
    savingSection.value = 'officials'
    const snap = { ...config.value.officialsConfig }
    config.value.officialsConfig = { ...patch }
    try {
      await updateClubConfig({ officialsConfig: patch })
      markSaved('officials')
    } catch (e: unknown) {
      config.value.officialsConfig = snap
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Dues config
  // -----------------------------------------------------

  async function saveDuesConfig(patch: DuesConfig): Promise<void> {
    if (!config.value) throw new Error('Settings non chargés')
    savingSection.value = 'dues'
    const snap = { ...config.value.duesConfig }
    config.value.duesConfig = { ...patch }
    try {
      await updateClubConfig({ duesConfig: patch })
      markSaved('dues')
    } catch (e: unknown) {
      config.value.duesConfig = snap
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Banking (IBAN, BIC, instructions paiement) — `/config/club.banking`
  // -----------------------------------------------------

  /**
   * Patch `banking` dans `/config/club`. Passe `null` pour effacer entièrement
   * (ex. reset). Tous les champs internes (`iban`, `bic`, `bankName`,
   * `accountHolder`, `paymentInstructions`) acceptent `null` (cf. shared-types
   * `BankingInfo`).
   *
   * UX : optimistic apply + rollback sur erreur. La section "general" reste
   * l'onglet visuel parent (Club info) mais on utilise une section dédiée
   * `banking` pour le flag `savingSection` afin de ne pas griser le bouton
   * "Sauvegarder" de la card identité club pendant un save banking.
   */
  async function saveBanking(banking: BankingInfo | null): Promise<void> {
    if (!config.value) throw new Error('Settings non chargés')
    savingSection.value = 'banking'
    const snap = config.value.banking ? { ...config.value.banking } : null
    config.value.banking = banking ? { ...banking } : null
    try {
      await updateClubConfig({ banking })
      markSaved('banking')
    } catch (e: unknown) {
      config.value.banking = snap
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde des infos bancaires')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Roles
  // -----------------------------------------------------

  async function addCustomRole(input: RoleInput): Promise<void> {
    savingSection.value = 'roles'
    try {
      const created = await createRole(input)
      roles.value.push(created)
      markSaved('roles')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la création du rôle')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  async function editRole(id: string, patch: RoleInput): Promise<void> {
    const idx = roles.value.findIndex((r) => r.id === id)
    if (idx === -1) return
    savingSection.value = 'roles'
    const snap = { ...roles.value[idx] }
    roles.value[idx] = { ...snap, name: patch.name, color: patch.color }
    try {
      await updateRole(id, patch)
      markSaved('roles')
    } catch (e: unknown) {
      roles.value[idx] = snap
      setError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour du rôle')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  async function removeRole(id: string): Promise<void> {
    const idx = roles.value.findIndex((r) => r.id === id)
    if (idx === -1) return
    savingSection.value = 'roles'
    const snap = roles.value[idx]
    roles.value.splice(idx, 1)
    try {
      await deleteRole(id)
      markSaved('roles')
    } catch (e: unknown) {
      roles.value.splice(idx, 0, snap)
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression du rôle')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Closure periods
  // -----------------------------------------------------

  async function addClosurePeriod(input: ClosurePeriodInput): Promise<void> {
    savingSection.value = 'closurePeriods'
    try {
      const created = await createClosurePeriod(input)
      closurePeriods.value.push(created)
      closurePeriods.value.sort((a, b) => a.startDate.seconds - b.startDate.seconds)
      markSaved('closurePeriods')
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Erreur lors de la création de la closure period',
      )
      throw e
    } finally {
      savingSection.value = null
    }
  }

  async function removeClosurePeriod(id: string): Promise<void> {
    const idx = closurePeriods.value.findIndex((p) => p.id === id)
    if (idx === -1) return
    savingSection.value = 'closurePeriods'
    const snap = closurePeriods.value[idx]
    closurePeriods.value.splice(idx, 1)
    try {
      await deleteClosurePeriod(id)
      markSaved('closurePeriods')
    } catch (e: unknown) {
      closurePeriods.value.splice(idx, 0, snap)
      setError(
        e instanceof Error ? e.message : 'Erreur lors de la suppression de la closure period',
      )
      throw e
    } finally {
      savingSection.value = null
    }
  }

  // -----------------------------------------------------
  // Admin team (v1 mock — pas d'écriture Firestore réelle)
  // -----------------------------------------------------

  /**
   * Banner "invitation enregistrée" affiché temporairement sous le formulaire
   * — distinct de `lastSaved` pour ne pas se concurrencer avec un autre
   * save concurrent.
   */
  const lastInvitedEmail = ref<string | null>(null)

  /**
   * Crée une invitation admin (Firestore `/invitations`). L'invité doit ensuite
   * signer in avec OAuth — `acceptInvitation` (callable) provisionnera son doc
   * `/users/{uid}` à partir de cette invitation. Optimistic : on push localement
   * avant le commit Firestore.
   */
  async function inviteAdminAction(input: AdminInviteInput): Promise<void> {
    savingSection.value = 'adminTeam'
    try {
      const invitation = await inviteAdmin(input)
      invitations.value.unshift(invitation)
      lastInvitedEmail.value = invitation.email
      window.setTimeout(() => {
        if (lastInvitedEmail.value === invitation.email) lastInvitedEmail.value = null
      }, 4000)
      markSaved('adminTeam')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'invitation")
      throw e
    } finally {
      savingSection.value = null
    }
  }

  /**
   * Annule une invitation pending. Optimistic remove + rollback si erreur.
   */
  async function cancelInvitationAction(id: string): Promise<void> {
    const idx = invitations.value.findIndex((i) => i.id === id)
    if (idx === -1) return
    savingSection.value = 'adminTeam'
    const snap = invitations.value[idx]
    invitations.value.splice(idx, 1)
    try {
      await cancelInvitation(id)
      markSaved('adminTeam')
    } catch (e: unknown) {
      invitations.value.splice(idx, 0, snap)
      setError(e instanceof Error ? e.message : "Erreur lors de l'annulation de l'invitation")
      throw e
    } finally {
      savingSection.value = null
    }
  }

  /**
   * Retire un admin. v1 stub :
   * - aucune écriture réelle ; le repo throw pas
   * - on retire localement la ligne pour le feedback visuel
   *
   * TODO(security): refus self-demote / last-admin via callable.
   */
  async function removeAdminAction(uid: string): Promise<void> {
    const idx = admins.value.findIndex((a) => a.id === uid)
    if (idx === -1) return
    const target = admins.value[idx]
    if (target.isRootAdmin) {
      throw new Error('Le rootAdmin ne peut pas être révoqué via l\'UI')
    }
    savingSection.value = 'adminTeam'
    const snap = target
    admins.value.splice(idx, 1)
    try {
      await removeAdmin(uid)
      markSaved('adminTeam')
    } catch (e: unknown) {
      admins.value.splice(idx, 0, snap)
      setError(e instanceof Error ? e.message : 'Erreur lors de la révocation admin')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  /**
   * Met à jour la liste complète des rôles app pour un user (admin team).
   * Sécurité côté rules : `/users.roles` est admin-only-write.
   *
   * Le rôle `admin` doit rester présent — sinon le user disparaîtrait de la
   * liste Admin team (la requête filtre par `roles array-contains 'admin'`).
   * Pour révoquer le rôle admin, utiliser `removeAdminAction` (callable
   * dédiée à terme).
   *
   * Optimistic apply + rollback en cas d'erreur Firestore.
   */
  async function updateAdminRoles(uid: string, roles: string[]): Promise<void> {
    const idx = admins.value.findIndex((a) => a.id === uid)
    if (idx === -1) return
    const target = admins.value[idx]
    if (!roles.includes('admin')) {
      throw new Error(
        "Le rôle 'admin' ne peut pas être retiré depuis cette UI — utilise 'Retirer'.",
      )
    }
    savingSection.value = 'adminTeam'
    const snapRoles = [...target.roles]
    admins.value[idx] = { ...target, roles: [...roles] }
    try {
      await updateUserRoles(uid, roles)
      markSaved('adminTeam')
    } catch (e: unknown) {
      admins.value[idx] = { ...target, roles: snapRoles }
      setError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour des rôles')
      throw e
    } finally {
      savingSection.value = null
    }
  }

  return {
    // state
    config,
    subscription,
    roles,
    closurePeriods,
    admins,
    invitations,
    loading,
    error,
    savingSection,
    lastSaved,
    lastInvitedEmail,
    // actions
    load,
    saveClubInfo,
    setLogo,
    removeLogo,
    saveOfficialsConfig,
    saveDuesConfig,
    saveBanking,
    addCustomRole,
    editRole,
    removeRole,
    addClosurePeriod,
    removeClosurePeriod,
    inviteAdminAction,
    cancelInvitationAction,
    removeAdminAction,
    updateAdminRoles,
  }
})
