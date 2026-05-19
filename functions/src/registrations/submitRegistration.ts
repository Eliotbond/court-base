/**
 * `submitRegistration`
 *
 * Callable invoqué à la fin du wizard d'inscription (§4.11). Crée
 * `/registrations/{id}` en `status: 'submitted'`, route en
 * `open_pending_trial` ou `conditional_pending_review` selon le
 * `team.registrationStatus`, et déclenche les side-effects (notifs coach +
 * admin, email récap user, ajout du rôle `parent` au /users/{uid} si
 * inscription pour un dépendant).
 *
 * Auth : signed-in. Le caller doit avoir un `/users/{uid}` (profil complété).
 *
 * Bypass des rules : Admin SDK. Le client n'a pas droit aux notifs ni à
 * /users.roles writes. Tout passe ici.
 *
 * Idempotence : si `draftRegistrationId` est fourni, on `update` le draft
 * existant (status = submitted) au lieu de créer un nouveau doc. Le client
 * en a besoin pour les soumissions depuis le bouton "Reprendre". Sinon, on
 * `addDoc`.
 *
 * Transaction : create/update registration + write notif coach + write notif
 * admin + arrayUnion 'parent' sur /users/{uid} si dépendant + enqueue email
 * /pendingEmails. Tout-ou-rien.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type {
  RegistrationActionLogEntry,
  RegistrationData,
  RegistrationFor,
  RegistrationRelationship,
  RegistrationStatus,
  TeamData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db, serverTimestamp } from './_helpers'

interface SubmitRegistrationInput {
  /** Si fourni, update un draft existant ; sinon crée un nouveau doc. */
  draftRegistrationId?: unknown
  registrationFor: unknown        // 'self' | 'dependent'
  relationship: unknown           // RegistrationRelationship | null
  relationshipOther: unknown      // string | null
  player: unknown                 // RegistrationPlayerIdentity (validé manuellement)
  matchedMemberId: unknown        // string | null
  teamId: unknown                 // string
  previouslyLicensed: unknown     // boolean
  previousClubName: unknown       // string | null
  previousClubAbroad: unknown     // boolean
  transferLetterStoragePath: unknown  // string | null
}

export interface SubmitRegistrationOutput {
  registrationId: string
  status: RegistrationStatus
}

const ALLOWED_RELATIONSHIPS: readonly RegistrationRelationship[] = [
  'parent',
  'legal_guardian',
  'sibling',
  'caritas',
  'other',
]

/** Format AVS suisse — identique à la validation du wizard register. */
const AVS_REGEX = /^756\.\d{4}\.\d{4}\.\d{2}$/

interface ParsedPlayer {
  firstName: string
  lastName: string
  birthDate: Date
  gender: 'M' | 'F' | 'other' | null
  avs: string
  phone: string | null
}

function parsePlayer(raw: unknown): ParsedPlayer {
  if (typeof raw !== 'object' || raw === null) {
    throw new HttpsError('invalid-argument', 'player must be an object')
  }
  const p = raw as Record<string, unknown>
  if (typeof p.firstName !== 'string' || p.firstName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'player.firstName is required')
  }
  if (typeof p.lastName !== 'string' || p.lastName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'player.lastName is required')
  }
  if (typeof p.birthDate !== 'string' || p.birthDate.length === 0) {
    throw new HttpsError('invalid-argument', 'player.birthDate is required (ISO YYYY-MM-DD)')
  }
  const dob = new Date(p.birthDate)
  if (Number.isNaN(dob.getTime())) {
    throw new HttpsError('invalid-argument', 'player.birthDate is not a valid ISO date')
  }
  // AVS obligatoire : un joueur sans AVS ne peut pas s'inscrire via le portail
  // (cas asile / transfert étranger → traités hors portail). Le wizard bloque
  // déjà la soumission, ce check est la défense serveur.
  const avs = typeof p.avs === 'string' ? p.avs.trim() : ''
  if (!AVS_REGEX.test(avs)) {
    throw new HttpsError(
      'invalid-argument',
      'player.avs is required and must match 756.XXXX.XXXX.XX',
    )
  }
  let gender: 'M' | 'F' | 'other' | null = null
  if (p.gender === 'M' || p.gender === 'F' || p.gender === 'other') gender = p.gender
  return {
    firstName: p.firstName.trim(),
    lastName: p.lastName.trim(),
    birthDate: dob,
    gender,
    avs,
    phone: typeof p.phone === 'string' && p.phone.length > 0 ? p.phone : null,
  }
}

interface ParsedInput {
  draftRegistrationId: string | null
  registrationFor: RegistrationFor
  relationship: RegistrationRelationship | null
  relationshipOther: string | null
  player: ParsedPlayer
  matchedMemberId: string | null
  teamId: string
  previouslyLicensed: boolean
  previousClubName: string | null
  previousClubAbroad: boolean
  transferLetterStoragePath: string | null
}

function parseInput(data: SubmitRegistrationInput): ParsedInput {
  const d = data ?? ({} as SubmitRegistrationInput)

  const registrationFor = d.registrationFor
  if (registrationFor !== 'self' && registrationFor !== 'dependent') {
    throw new HttpsError('invalid-argument', "registrationFor must be 'self' or 'dependent'")
  }

  let relationship: RegistrationRelationship | null = null
  if (registrationFor === 'dependent') {
    const r = d.relationship
    if (typeof r !== 'string' || !ALLOWED_RELATIONSHIPS.includes(r as RegistrationRelationship)) {
      throw new HttpsError('invalid-argument', 'relationship is required when dependent')
    }
    relationship = r as RegistrationRelationship
  }

  const relationshipOther = relationship === 'other'
    ? (typeof d.relationshipOther === 'string' && d.relationshipOther.trim().length > 0
        ? d.relationshipOther.trim()
        : null)
    : null
  if (relationship === 'other' && !relationshipOther) {
    throw new HttpsError('invalid-argument', "relationshipOther required when relationship='other'")
  }

  if (typeof d.teamId !== 'string' || d.teamId.length === 0) {
    throw new HttpsError('invalid-argument', 'teamId is required')
  }

  return {
    draftRegistrationId: typeof d.draftRegistrationId === 'string' && d.draftRegistrationId.length > 0
      ? d.draftRegistrationId : null,
    registrationFor,
    relationship,
    relationshipOther,
    player: parsePlayer(d.player),
    matchedMemberId: typeof d.matchedMemberId === 'string' && d.matchedMemberId.length > 0
      ? d.matchedMemberId : null,
    teamId: d.teamId,
    previouslyLicensed: d.previouslyLicensed === true,
    previousClubName: typeof d.previousClubName === 'string' && d.previousClubName.trim().length > 0
      ? d.previousClubName.trim() : null,
    previousClubAbroad: d.previousClubAbroad === true,
    transferLetterStoragePath: typeof d.transferLetterStoragePath === 'string' && d.transferLetterStoragePath.length > 0
      ? d.transferLetterStoragePath : null,
  }
}

/**
 * Détermine le status initial de la registration en fonction du
 * `team.registrationStatus`. Cf. `docs/chantier-registrations.md` §4.6 / §4.7.
 */
function initialStatusForTeam(teamRegistrationStatus: string | undefined): RegistrationStatus {
  if (teamRegistrationStatus === 'open') return 'open_pending_trial'
  if (teamRegistrationStatus === 'conditional') return 'conditional_pending_review'
  // `closed` ou absent : on rejette en amont — la soumission ne devrait pas arriver ici.
  throw new HttpsError(
    'failed-precondition',
    'Team is not accepting new registrations (registrationStatus !== open|conditional)',
  )
}

export const submitRegistration = onCall(
  async (
    request: CallableRequest<SubmitRegistrationInput>,
  ): Promise<SubmitRegistrationOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const input = parseInput(request.data)

    // Précharge team + user docs hors transaction (stables pendant le call).
    const teamRef = db().doc(`teams/${input.teamId}`)
    const teamSnap = await teamRef.get()
    if (!teamSnap.exists) {
      throw new HttpsError('not-found', `team ${input.teamId} not found`)
    }
    const team = teamSnap.data() as TeamData & { registrationStatus?: string }
    const initialStatus = initialStatusForTeam(team.registrationStatus)

    const userRef = db().doc(`users/${callerUid}`)
    const userSnap = await userRef.get()
    if (!userSnap.exists) {
      // Sécurité : le wizard exige `profileCompletedAt`. Si le client appelle
      // submitRegistration sans /users/{uid}, on refuse explicitement.
      throw new HttpsError('failed-precondition', 'user profile not completed')
    }
    // Member lié au caller (si le user est lui-même un membre du club). Le rôle
    // `parent` posé plus bas sur `/users.roles` serait écrasé par
    // `syncUserRolesFromMember` (copie verbatim de `member.roles`) au prochain
    // write de ce membre → on doit aussi le poser sur `member.roles`.
    const callerMemberId =
      typeof (userSnap.data() as UserData).memberId === 'string'
        ? ((userSnap.data() as UserData).memberId as string)
        : null

    // Identifiant de la registration : draft existant OU nouveau.
    const registrationRef = input.draftRegistrationId
      ? db().doc(`registrations/${input.draftRegistrationId}`)
      : db().collection('registrations').doc()

    const playerBirthDate = Timestamp.fromDate(input.player.birthDate)
    const now = Timestamp.now()
    const initialAction: RegistrationActionLogEntry = {
      at: now,
      byUid: callerUid,
      action: 'submitted',
      previousStatus: null,
      newStatus: initialStatus,
      note: null,
    }

    await db().runTransaction(async (tx) => {
      // Si draft fourni, on vérifie qu'il appartient au caller et qu'il est
      // encore en `draft`. Sinon, refuse — le client doit en créer un nouveau.
      if (input.draftRegistrationId) {
        const draft = await tx.get(registrationRef)
        if (!draft.exists) {
          throw new HttpsError('not-found', `draft ${input.draftRegistrationId} not found`)
        }
        const draftData = draft.data() as RegistrationData
        if (draftData.submittedByUid !== callerUid) {
          throw new HttpsError('permission-denied', 'draft belongs to another user')
        }
        if (draftData.status !== 'draft') {
          throw new HttpsError(
            'failed-precondition',
            `registration already submitted (status=${draftData.status})`,
          )
        }
      }

      const baseLog = input.draftRegistrationId ? [] as RegistrationActionLogEntry[] : []
      // Note : pour les drafts, l'actionLog existant est préservé via FieldValue.arrayUnion
      // ailleurs (autosave côté client). Ici on l'append.
      const data: RegistrationData = {
        submittedByUid: callerUid,
        registrationFor: input.registrationFor,
        relationship: input.relationship,
        relationshipOther: input.relationshipOther,
        player: {
          firstName: input.player.firstName,
          lastName: input.player.lastName,
          birthDate: playerBirthDate,
          gender: input.player.gender,
          avs: input.player.avs,
          phone: input.player.phone,
        },
        matchedMemberId: input.matchedMemberId,
        teamId: input.teamId,
        previouslyLicensed: input.previouslyLicensed,
        previousClubName: input.previousClubName,
        previousClubAbroad: input.previousClubAbroad,
        transferLetterStoragePath: input.transferLetterStoragePath,
        foreignTransfer: input.previousClubAbroad,
        status: initialStatus,
        statusUpdatedAt: now,
        trialStartedAt: null,
        refusalReason: null,
        refusedByUid: null,
        actionLog: [...baseLog, initialAction],
        coachNotifiedAt: null,
        adminNotifiedAt: null,
        createdAt: now,
      }

      if (input.draftRegistrationId) {
        // Update : on patch les champs (préserve `createdAt` initial via merge sémantique
        // — on overwrite avec `set` car on a écrasé `createdAt = now` qui doit rester
        // l'original. Pour rester safe, on relit et on conserve l'original).
        const draftAgain = await tx.get(registrationRef)
        const original = draftAgain.data() as RegistrationData
        const merged: RegistrationData = {
          ...data,
          createdAt: original.createdAt,
          actionLog: [...(original.actionLog ?? []), initialAction],
        }
        tx.set(registrationRef, merged)
      } else {
        tx.set(registrationRef, data)
      }

      // Side-effects côté domaine.
      const playerLabel = `${input.player.firstName} ${input.player.lastName}`

      // 1) Ajout du rôle `parent` au /users/{uid} si registration pour un dépendant.
      //    `arrayUnion` est idempotent — pas de double si déjà parent.
      if (input.registrationFor === 'dependent') {
        tx.update(userRef, {
          roles: admin.firestore.FieldValue.arrayUnion('parent'),
        })
        // Si le caller est lui-même un membre du club (`memberId` lié), on
        // doit aussi poser `parent` sur `member.roles` : le trigger
        // `syncUserRolesFromMember` recopie `member.roles` verbatim dans
        // `/users.roles` (en écrasant) — sans ça, le `parent` posé ci-dessus
        // serait effacé au prochain write du membre lié. Pour un parent "pur"
        // (pas de member lié) le write `/users.roles` ci-dessus suffit, le
        // trigger ne le touche jamais.
        if (callerMemberId) {
          tx.update(db().doc(`members/${callerMemberId}`), {
            roles: admin.firestore.FieldValue.arrayUnion('parent'),
          })
        }
      } else {
        // Self-registration majeure : le user devient son propre member à
        // l'acceptation coach (création/link de /members/{id} hors scope de
        // cette callable). Pas de role 'parent' ajouté.
      }

      // 2) Notif coach (un doc par head coach + admin). On vise tous les
      //    coachIds de la team (ils sont peu nombreux).
      const notifType = initialStatus === 'open_pending_trial'
        ? 'new_registration_open'
        : 'new_registration_conditional'
      for (const coachId of team.coachIds ?? []) {
        const notifRef = db().collection('notifications').doc(
          `${registrationRef.id}_coach_${coachId}`,
        )
        tx.set(notifRef, {
          type: notifType,
          recipientMemberId: coachId,
          payload: {
            registrationId: registrationRef.id,
            teamId: input.teamId,
            playerName: playerLabel,
          },
          readBy: [],
          createdAt: serverTimestamp(),
        })
      }

      // 3) Notif admin (broadcast — pas de filtrage par UID admin, ils liront via /notifications).
      const adminNotifRef = db().collection('notifications').doc(
        `${registrationRef.id}_admin_broadcast`,
      )
      tx.set(adminNotifRef, {
        type: notifType,
        recipientRole: 'admin',
        payload: {
          registrationId: registrationRef.id,
          teamId: input.teamId,
          playerName: playerLabel,
        },
        readBy: [],
        createdAt: serverTimestamp(),
      })

      // 4) Tracking notif posed.
      tx.update(registrationRef, {
        coachNotifiedAt: now,
        adminNotifiedAt: now,
      })

      // 5) Email de confirmation au user — enqueue dans /pendingEmails.
      const userData = userSnap.data() as UserData
      const recipientEmail = userData.email ?? null
      const pendingEmailRef = db().doc(
        `pendingEmails/${registrationRef.id}_registration_submitted_confirm`,
      )
      tx.set(pendingEmailRef, {
        to: recipientEmail,
        template: 'registration_submitted_confirm',
        context: {
          submittedByUid: callerUid,
          registrationId: registrationRef.id,
          teamId: input.teamId,
          playerName: playerLabel,
          status: initialStatus,
        },
        createdAt: serverTimestamp(),
        sentAt: null,
      })
    })

    logger.info('submitRegistration: created', {
      registrationId: registrationRef.id,
      callerUid,
      teamId: input.teamId,
      status: initialStatus,
      registrationFor: input.registrationFor,
    })

    return {
      registrationId: registrationRef.id,
      status: initialStatus,
    }
  },
)
