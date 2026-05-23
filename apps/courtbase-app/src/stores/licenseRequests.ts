/**
 * Store mock — Demandes de licence fédérale (coach).
 *
 * Minimal : lit les fixtures partagées (`@club-app/shared-types`) et expose
 * un `create()` log-only qui simule l'envoi d'un email au parent. La
 * création **ne mute pas** le tableau source (cohérent avec la convention
 * "mock immuable" du repo). Côté UI, après création on affiche un toast +
 * le `console.info` du faux email — refresh = retour aux fixtures.
 *
 * Quand on branchera Firestore :
 *   - `create()` deviendra un callable `requestLicenseDocuments(...)`.
 *   - On ajoutera un listener temps-réel pour suivre les statuts.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  MOCK_LICENSE_REQUESTS,
  type LicenseDocKind,
  type LicenseRequestMock,
} from '@club-app/shared-types'

import {
  getLicenseRequestById,
  listLicenseRequestsForMember,
} from '@/repositories/mock/licenseRequests'
import { logMockAction, getMember, getTeam } from '@/repositories/mock'

export interface CreateLicenseRequestInput {
  memberId: string
  /** Pour un membre multi-équipes, l'équipe au nom de laquelle on demande. */
  teamId: string | undefined
  requiredDocs: LicenseDocKind[]
}

export interface CreateLicenseRequestResult {
  ok: true
  /** Id artificiel pour le toast — pas un vrai id Firestore. */
  mockId: string
}

/**
 * Mapping `LicenseDocKind` → libellé humain (utilisé dans le faux email).
 * Tenu à l'écart de l'UI pour rester réutilisable.
 */
const DOC_LABELS: Record<LicenseDocKind, string> = {
  id_front: "Carte d'identité (recto)",
  id_back: "Carte d'identité (verso)",
  avs: 'Numéro AVS',
  transfer_letter_swiss: 'Lettre de sortie du club précédent',
}

export const useLicenseRequestsStore = defineStore('licenseRequests', () => {
  // Copie des fixtures source — placeholder pour quand on branchera Firestore.
  // Volontairement pas de `MOCK_LICENSE_REQUESTS.slice()` directement réactif
  // côté UI : on s'appuie sur les fixtures pour les lectures (cf. helpers).
  const requests = ref<LicenseRequestMock[]>(MOCK_LICENSE_REQUESTS.slice())

  // ─── Getters / lecture ──────────────────────────────────────────

  function listForMember(memberId: string): LicenseRequestMock[] {
    return listLicenseRequestsForMember(memberId)
  }

  function getById(id: string): LicenseRequestMock | undefined {
    return getLicenseRequestById(id)
  }

  // ─── Mutations log-only ─────────────────────────────────────────

  /**
   * Simule la création d'une demande de licence. **Ne mute pas** les fixtures.
   * Effets :
   *   - `logMockAction('licenseRequests.create', ...)` pour la trace dev.
   *   - `console.info` d'un faux email encadré, avec lien cliquable vers
   *     l'app parent (`localhost:5174/account/license-requests/<mockId>`).
   *
   * Retourne `{ ok: true, mockId }` — le caller peut afficher un toast.
   */
  function create(input: CreateLicenseRequestInput): CreateLicenseRequestResult {
    const mockId = `lr-mock-${Date.now()}`

    logMockAction('licenseRequests.create', {
      memberId: input.memberId,
      teamId: input.teamId,
      requiredDocs: input.requiredDocs,
      mockId,
    })

    // ─── Faux email pour le parent ──────────────────────────────
    const member = getMember(input.memberId)
    const team = input.teamId ? getTeam(input.teamId) : null
    const coachName = 'Mathieu Brun' // Cohérent MOCK_SESSION
    const parentEmail = 'parent@example.ch' // Mock — pas de vrai email
    const memberFirst = member?.firstName ?? 'le joueur'
    const teamName = team?.name ?? 'l\'équipe'
    const docs = input.requiredDocs.map((k) => `    - ${DOC_LABELS[k]}`).join('\n')
    const link = `http://localhost:5174/account/license-requests/${mockId}`

    const emailBox = [
      '╔════════════════════════════════════════════════════════════════════╗',
      `║  [MOCK EMAIL] À: ${parentEmail.padEnd(46)}║`,
      `║  Sujet: Documents licence à fournir pour ${memberFirst.padEnd(24)}║`,
      '║                                                                    ║',
      '║  Bonjour,                                                          ║',
      `║  Le coach ${coachName} a démarré une demande de licence pour       ║`,
      `║  ${memberFirst} (${teamName}). Merci de compléter les documents :  ║`,
      docs,
      '║                                                                    ║',
      `║  → ${link}`,
      '╚════════════════════════════════════════════════════════════════════╝',
    ].join('\n')

    // eslint-disable-next-line no-console
    console.info(emailBox)

    return { ok: true, mockId }
  }

  return {
    // state
    requests,
    // getters
    listForMember,
    getById,
    // actions
    create,
  }
})
