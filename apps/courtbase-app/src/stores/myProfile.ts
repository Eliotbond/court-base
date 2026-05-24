/**
 * Store MyProfile — données personnelles du user connecté (courtbase-app).
 *
 * Charge à la demande :
 *  - le linked member (`/members/{userDoc.memberId}`) si le user en a un ;
 *  - le contact privé (`/members/{id}/private/contact`) — email + phone du
 *    member, distincts du compte Auth ;
 *  - les équipes auxquelles ce member appartient (`listTeamsForMember`).
 *
 * Permet aussi d'éditer le contact privé (write client direct autorisé par
 * la rule `/members/{id}/private/contact` quand `isLinkedMember(memberId)`,
 * cf. `firestore.rules` lignes 195-199).
 *
 * Pattern :
 *  - Pas de cache global membre/team (lifecycle court : 1 user = 1 profile).
 *  - Idempotent : `load()` ne refait rien si déjà chargé sauf `force=true`.
 *  - Reset au sign-out (cf. `useAuthStore.signOut` — la pinia store est
 *    réinitialisée au prochain init via lecture de `userDoc?.memberId`).
 *
 * Cf. mémoire `[[courtbase_app_auth_hybrid]]` — ce store remplace
 * progressivement le fallback mock `auth.linkedMember` pour cette vue.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { FirebaseError } from 'firebase/app'

import {
  getMember,
  getMemberContact,
  updateMemberContact,
  type MemberContact,
} from '@/repositories/members.repo'
import { listTeamsForMember } from '@/repositories/teams.repo'
import type { MockMember, MockTeam } from '@/types/mock'
import { useAuthStore } from '@/stores/auth'

export const useMyProfileStore = defineStore('myProfile', () => {
  // ─── State ──────────────────────────────────────────────────────
  const member = ref<MockMember | null>(null)
  const contact = ref<MemberContact | null>(null)
  const teams = ref<MockTeam[]>([])

  /** True pendant le fetch initial (member + contact + teams). */
  const loading = ref(false)
  /** True pendant un save de contact privé. */
  const savingContact = ref(false)

  /** Dernière erreur de chargement (string FR pour UI). */
  const loadError = ref<string | null>(null)
  /** Dernière erreur d'écriture contact (string FR). */
  const saveError = ref<string | null>(null)
  /**
   * True si la dernière tentative de save contact a échoué pour cause de
   * permission-denied — l'UI peut désactiver le bouton et afficher un
   * helper text "Contactez votre admin".
   */
  const contactWriteDenied = ref(false)

  /** Id du member actuellement chargé (pour gating idempotent). */
  const loadedMemberId = ref<string | null>(null)

  // ─── Getters ────────────────────────────────────────────────────

  const fullName = computed(() => {
    const m = member.value
    if (!m) return ''
    return `${m.firstName} ${m.lastName}`.trim()
  })

  const teamsLabel = computed(() => {
    if (teams.value.length === 0) return 'Aucune équipe assignée'
    return teams.value.map((t) => t.name).join(' · ')
  })

  // ─── Actions ────────────────────────────────────────────────────

  /**
   * Charge le profil pour le user actuellement connecté. Idempotent : si le
   * memberId est déjà chargé, ne refait rien (sauf `force=true`).
   *
   * Retourne immédiatement si le user n'a pas de `memberId` dans son userDoc
   * (cas d'un coach/officiel/admin pur sans member lié — possible pour les
   * profils administratifs).
   */
  async function load(opts: { force?: boolean } = {}): Promise<void> {
    const auth = useAuthStore()
    const memberId = auth.userDoc?.memberId ?? null

    if (!memberId) {
      // User sans member lié — reset le state au cas où un précédent profil
      // serait encore en mémoire (changement de compte).
      member.value = null
      contact.value = null
      teams.value = []
      loadedMemberId.value = null
      return
    }

    if (!opts.force && loadedMemberId.value === memberId && member.value) {
      return
    }

    loading.value = true
    loadError.value = null
    try {
      // Parallèle : member, contact, teams sont 3 reads indépendants.
      const [m, c, ts] = await Promise.all([
        getMember(memberId),
        getMemberContact(memberId),
        listTeamsForMember(memberId),
      ])
      member.value = m
      // `getMemberContact` retourne soit `null` (erreur/rules), soit
      // `{ email: null, phone: null }` (doc absent), soit le doc réel.
      contact.value = c
      teams.value = ts
      loadedMemberId.value = memberId
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[myProfile.store] load failed [${code}]`, err)
      loadError.value = 'Impossible de charger votre profil. Réessayez.'
    } finally {
      loading.value = false
    }
  }

  /**
   * Met à jour le contact privé du linked member. Write client direct (rules
   * autorisent `isLinkedMember(memberId)`, cf. firestore.rules:195-199).
   *
   * Retourne `true` si succès, `false` si échec (l'erreur est exposée via
   * `saveError` et `contactWriteDenied`).
   *
   * Garde-fou : si le caller n'a pas de memberId, l'opération est rejetée
   * silencieusement (UI ne devrait pas exposer le formulaire dans ce cas).
   */
  async function saveContact(input: MemberContact): Promise<boolean> {
    const auth = useAuthStore()
    const memberId = auth.userDoc?.memberId ?? null
    if (!memberId) {
      saveError.value = 'Aucun profil joueur lié à votre compte.'
      return false
    }

    savingContact.value = true
    saveError.value = null
    contactWriteDenied.value = false
    try {
      await updateMemberContact(memberId, input)
      contact.value = {
        email: input.email ?? null,
        phone: input.phone ?? null,
      }
      return true
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : 'unknown'
      console.error(`[myProfile.store] saveContact failed [${code}]`, err)
      if (code === 'permission-denied') {
        contactWriteDenied.value = true
        saveError.value =
          "Vous n'avez pas les droits pour modifier ce contact. Contactez votre administrateur."
      } else {
        saveError.value = "Échec de l'enregistrement. Réessayez."
      }
      return false
    } finally {
      savingContact.value = false
    }
  }

  /** Vide le state — typiquement après sign-out. */
  function reset(): void {
    member.value = null
    contact.value = null
    teams.value = []
    loadedMemberId.value = null
    loading.value = false
    savingContact.value = false
    loadError.value = null
    saveError.value = null
    contactWriteDenied.value = false
  }

  return {
    // state
    member,
    contact,
    teams,
    loading,
    savingContact,
    loadError,
    saveError,
    contactWriteDenied,
    // getters
    fullName,
    teamsLabel,
    // actions
    load,
    saveContact,
    reset,
  }
})
