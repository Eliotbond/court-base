/**
 * `coachCreateMember`
 *
 * Callable invoquée par un coach (ou admin) depuis l'app mobile pour créer un
 * joueur dans une de ses équipes. `/members` étant write-admin-only dans
 * `firestore.rules`, cette callable est le canal contrôlé : elle re-vérifie le
 * scope coach côté serveur (Admin SDK bypasse les rules).
 *
 * Effets transactionnels :
 *  1. Dédup (`findExactMemberMatch`) — si un membre identique existe déjà
 *     (AVS, ou nom+date de naissance), on le réutilise au lieu d'en créer un
 *     doublon. `memberCreated: false` dans ce cas.
 *  2. Sinon crée `/members/{id}` (joueur : `roles: ['player']`, qualifications
 *     et licences nulles — réglées par l'admin) + `/members/{id}/private/contact`.
 *  3. `arrayUnion` du memberId dans `team.playerIds` — déclenche en cascade le
 *     trigger `initiateDuesOnPlayerActivation` (crée le `/dues`, flip
 *     `member.duesStatus`).
 *
 * Auth : signed-in. Le caller doit être admin OU coach de la team cible.
 */
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type { MemberContactData, MemberData } from '@club-app/shared-types'
import { Timestamp, db } from '../registrations/_helpers'
import { assertCoachOrAdminOfTeam, loadCallerUser } from './_coachAuth'
import { defaultComms, findExactMemberMatch } from './_helpers'

interface CoachCreateMemberInput {
  teamId: unknown
  firstName: unknown
  lastName: unknown
  /** epoch millis ; `null` = date de naissance inconnue. */
  birthDate: unknown
  avs: unknown
  email: unknown
  phone: unknown
}

export interface CoachCreateMemberOutput {
  ok: true
  memberId: string
  /** `true` si un nouveau `/members/{id}` a été créé ; `false` si réutilisé (dédup). */
  memberCreated: boolean
  /** `true` si le membre a été ajouté à `team.playerIds` (toujours vrai en succès). */
  addedToTeam: boolean
}

interface ParsedInput {
  teamId: string
  firstName: string
  lastName: string
  birthDate: number | null
  avs: string | null
  email: string | null
  phone: string | null
}

function reqString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpsError('invalid-argument', `${field} is required`)
  }
  return value.trim()
}

function optString(value: unknown, field: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string or null`)
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function parseInput(data: CoachCreateMemberInput): ParsedInput {
  const d = data ?? ({} as CoachCreateMemberInput)
  let birthDate: number | null = null
  if (d.birthDate != null) {
    if (typeof d.birthDate !== 'number' || !Number.isFinite(d.birthDate)) {
      throw new HttpsError(
        'invalid-argument',
        'birthDate must be an epoch-millis number or null',
      )
    }
    birthDate = d.birthDate
  }
  return {
    teamId: reqString(d.teamId, 'teamId'),
    firstName: reqString(d.firstName, 'firstName'),
    lastName: reqString(d.lastName, 'lastName'),
    birthDate,
    avs: optString(d.avs, 'avs'),
    email: optString(d.email, 'email'),
    phone: optString(d.phone, 'phone'),
  }
}

export const coachCreateMember = onCall(
  async (
    request: CallableRequest<CoachCreateMemberInput>,
  ): Promise<CoachCreateMemberOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    const userData = await loadCallerUser(callerUid)
    assertCoachOrAdminOfTeam(
      { uid: callerUid, token: request.auth.token },
      input.teamId,
      userData,
    )

    const birthTs =
      input.birthDate != null ? Timestamp.fromMillis(input.birthDate) : null

    let resolvedMemberId = ''
    let memberCreated = false

    await db().runTransaction(async (tx) => {
      // --- Lectures (toutes avant les writes — contrainte Firestore) ---
      const teamRef = db().doc(`teams/${input.teamId}`)
      const teamSnap = await tx.get(teamRef)
      if (!teamSnap.exists) {
        throw new HttpsError('not-found', `team ${input.teamId} not found`)
      }

      const matchedId = await findExactMemberMatch(tx, {
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: birthTs,
        avs: input.avs,
      })

      const now = Timestamp.now()

      // --- Résolution / création du membre ---
      let memberId: string
      if (matchedId) {
        memberId = matchedId
        memberCreated = false
      } else {
        const memberRef = db().collection('members').doc()
        memberId = memberRef.id
        memberCreated = true

        const memberData: MemberData = {
          firstName: input.firstName,
          lastName: input.lastName,
          status: 'active',
          archivedAt: null,
          archivedReason: null,
          archivedByUid: null,
          roles: ['player'],
          linkedUserId: null,
          licenseNumber: '',
          officialLevel: null,
          coachLevel: null,
          officialLicense: null,
          coachLicense: null,
          licensed: false,
          duesStatus: 'n/a', // flippé par initiateDuesOnPlayerActivation
          duesStatusUpdatedAt: now,
          active: true,
          birthDate: birthTs,
          guardianUserIds: [],
          comms: defaultComms(birthTs, now),
          avs: input.avs,
          transferState: 'none',
        }
        tx.set(memberRef, memberData)

        const contact: MemberContactData = {
          email: input.email ?? '',
          phone: input.phone ?? '',
        }
        tx.set(db().doc(`members/${memberId}/private/contact`), contact)
      }
      resolvedMemberId = memberId

      // --- Rattachement à l'équipe (déclenche le trigger dues) ---
      tx.update(teamRef, {
        playerIds: admin.firestore.FieldValue.arrayUnion(memberId),
      })
    })

    logger.info('[coachCreateMember] ok', {
      callerUid,
      teamId: input.teamId,
      memberId: resolvedMemberId,
      memberCreated,
    })

    return {
      ok: true,
      memberId: resolvedMemberId,
      memberCreated,
      addedToTeam: true,
    }
  },
)
