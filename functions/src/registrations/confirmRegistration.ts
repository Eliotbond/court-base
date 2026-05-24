/**
 * `confirmRegistration`
 *
 * Callable invoquée par un coach (ou admin) à la fin de la période d'essai
 * pour confirmer l'intégration du joueur — l'essai s'interrompt et la
 * cotisation est émise (transition `trial_in_progress` →
 * `confirmed_pending_dues`, cf. `docs/registrations/lifecycle.md` §4).
 *
 * Effets transactionnels :
 *  1. Si `registration.matchedMemberId === null` : crée un `/members/{id}`
 *     depuis `registration.player`. Sinon, réutilise le member existant.
 *  2. Ajoute le memberId à `team.playerIds` (arrayUnion idempotent) — déclenche
 *     en cascade le trigger `initiateDuesOnPlayerActivation` qui crée le
 *     `/dues/{id}` et flip `member.duesStatus = 'pending_grace'`.
 *  3. Update `registration.status = 'confirmed_pending_dues'`,
 *     `statusUpdatedAt`, `matchedMemberId` (dénormalisé pour les nouvelles
 *     créations), append actionLog.
 *
 * Auth : signed-in. Le caller doit être admin OU coach de la team.
 *
 * State preconditions : `status === 'trial_in_progress'`. Une confirmation
 * directement depuis un état pre-trial est rejetée — le coach doit d'abord
 * passer par `markTrialInProgress`.
 *
 * Member creation rules :
 *  - `for: 'self'`     → `linkedUserId = submittedByUid`, `guardianUserIds = []`,
 *                        `comms` adulte (recipients = ['member']).
 *  - `for: 'dependent'`→ `linkedUserId = null`, `guardianUserIds = [submittedByUid]`,
 *                        `comms` dérivé de `birthDate` (mineur → 'guardians',
 *                        majeur → 'member').
 *
 * Existing-member binding rules (matched via `reg.matchedMemberId` ou
 * `findExactMemberMatch`) — sans ce binding, le submitter n'est pas tuteur du
 * member matched et les rules `/dues` lui refusent la lecture, donc l'app
 * register affiche vide alors qu'une cotisation existe :
 *  - `for: 'dependent'` → `guardianUserIds` arrayUnion `submittedByUid` si
 *                          absent. Idempotent.
 *  - `for: 'self'`      → `linkedUserId = submittedByUid` si `null`. Si déjà
 *                          lié à un AUTRE uid, on logge un warn et on ne
 *                          touche pas (préservation du binding existant ; le
 *                          submitter ne verra pas la cotisation côté register
 *                          — cas pathologique à régler manuellement).
 *  - Réactivation        → si le member matched est inactif (`active === false`)
 *                          ou archivé (`status === 'archived'`), la réinscription
 *                          le réactive : `active = true`, `status = 'active'`,
 *                          `archivedAt/archivedReason/archivedByUid = null`. Règle
 *                          métier : un membre inactif/archivé qui se réinscrit via
 *                          le portail register reprend l'accès. La réactivation et
 *                          le binding sont fusionnés dans un unique `tx.update` du
 *                          memberRef ; aucun write si rien n'a changé.
 *
 * Linking inverse (`/users/{submittedByUid}.memberId`) : posé dans la même
 * transaction pour `for: 'self'` (cf. bloc 1.6). Préserve un binding existant
 * vers un AUTRE member (warn + skip). Sans ce miroir, le repo register ne
 * trouvait pas le memberId du submitter et la query `memberId in [...]` sur
 * `/dues` retournait vide alors qu'une cotisation existait — symptôme
 * "factures introuvables" pour un joueur majeur inscrit pour lui-même.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import type {
  CommsRecipient,
  MemberCommsConfig,
  MemberData,
  RegistrationActionLogEntry,
  RegistrationData,
  TeamData,
  UserData,
} from '@club-app/shared-types'
import { Timestamp, db, normalizeName, serverTimestamp } from './_helpers'

interface ConfirmRegistrationInput {
  registrationId: unknown
}

export interface ConfirmRegistrationOutput {
  ok: true
  registrationId: string
  memberId: string
  /** `true` si on a créé un nouveau `/members/{id}` ; `false` si on a réutilisé `matchedMemberId`. */
  memberCreated: boolean
  status: 'confirmed_pending_dues'
}

/** Âge légal CH — duplique `apps/web/src/repositories/members.repo.ts` (constante stable). */
const MAJORITY_AGE_YEARS = 18

/**
 * Comparaison day-grained sur `{ seconds }` — accepte aussi bien le shared-types
 * `Timestamp` que l'admin `FirebaseFirestore.Timestamp` (structurellement
 * compatibles côté lecture).
 */
function isMinor(
  birthDate: { seconds: number },
  now: { seconds: number },
): boolean {
  const SECONDS_PER_YEAR = Math.round(365.25 * 86_400)
  const eighteenYearsLater = birthDate.seconds + MAJORITY_AGE_YEARS * SECONDS_PER_YEAR
  return eighteenYearsLater > now.seconds
}

function defaultComms(
  birthDate: { seconds: number },
  now: { seconds: number },
  registrationFor: 'self' | 'dependent',
): MemberCommsConfig {
  // Pour `self`, on force `member` même si la birthDate est manquante / fausse :
  // un user qui s'inscrit lui-même est par définition l'adulte interlocuteur.
  let recipient: CommsRecipient
  if (registrationFor === 'self') {
    recipient = 'member'
  } else {
    recipient = isMinor(birthDate, now) ? 'guardians' : 'member'
  }
  return {
    billingRecipients: [recipient],
    generalRecipients: [recipient],
    majorityTransition: null,
  }
}

/**
 * Match strict d'un member existant à partir des données identité de la
 * registration. Utilisé en **défense en profondeur** par `confirmRegistration`
 * quand `registration.matchedMemberId` est nul — typiquement quand le wizard
 * parent n'a pas proposé / persisté de match, mais qu'un member a été créé
 * indépendamment (coach qui crée un joueur en "essai" via apps/web ou admin
 * qui pré-saisit un member depuis Members.vue).
 *
 * Stratégie (strict, pas fuzzy — on est en transaction de confirmation, on ne
 * peut pas se permettre un faux positif) :
 *  1. Si AVS présent : match exact `avs`. 0 → fallthrough ; 1 → utilise ;
 *     ≥2 → conflit DB, throw `failed-precondition` pour forcer dédoublonnage
 *     manuel.
 *  2. Sinon : query day-window sur `birthDate` puis filtre client sur
 *     `firstName` + `lastName` normalisés. Idem : 0/1/≥2 → null/use/throw.
 *
 * La query est exécutée **dans la transaction** (`tx.get(query)`) — Firestore
 * Admin SDK le supporte, à condition de la faire avant toute write.
 */
async function findExactMemberMatch(
  tx: FirebaseFirestore.Transaction,
  player: {
    firstName: string
    lastName: string
    birthDate: { seconds: number; nanoseconds: number }
    avs: string | null
  },
): Promise<string | null> {
  // 1. AVS — un AVS est censé être unique à une personne.
  if (player.avs) {
    const avsQuery = db().collection('members').where('avs', '==', player.avs).limit(2)
    const snap = await tx.get(avsQuery)
    if (snap.size === 1) return snap.docs[0]!.id
    if (snap.size > 1) {
      throw new HttpsError(
        'failed-precondition',
        `Plusieurs members partagent l'AVS ${player.avs}. Dédoublonnez manuellement avant de confirmer.`,
      )
    }
    // 0 résultat → fallthrough vers match name+DOB (cas typique : coach a
    // créé le member sans AVS).
  }

  // 2. firstName + lastName + birthDate (jour exact).
  const start = new Date(player.birthDate.seconds * 1000)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  const dobQuery = db().collection('members')
    .where('birthDate', '>=', Timestamp.fromDate(start))
    .where('birthDate', '<', Timestamp.fromDate(end))
    .limit(10)
  const snap = await tx.get(dobQuery)
  if (snap.empty) return null

  const firstNorm = normalizeName(player.firstName)
  const lastNorm = normalizeName(player.lastName)
  const matches = snap.docs.filter((d) => {
    const m = d.data() as MemberData
    return (
      normalizeName(m.firstName) === firstNorm &&
      normalizeName(m.lastName) === lastNorm
    )
  })
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    const iso = start.toISOString().slice(0, 10)
    throw new HttpsError(
      'failed-precondition',
      `Plusieurs members correspondent à ${player.firstName} ${player.lastName} (${iso}). Dédoublonnez manuellement avant de confirmer.`,
    )
  }
  return null
}

function parseInput(data: ConfirmRegistrationInput): { registrationId: string } {
  const d = data ?? ({} as ConfirmRegistrationInput)
  if (typeof d.registrationId !== 'string' || d.registrationId.length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required')
  }
  return { registrationId: d.registrationId }
}

function assertCoachOrAdmin(user: UserData, teamId: string): void {
  if (user.roles?.includes('admin')) return
  if (user.roles?.includes('coach') && (user.teamIds ?? []).includes(teamId)) return
  throw new HttpsError(
    'permission-denied',
    'Caller is neither admin nor coach of this team.',
  )
}

export const confirmRegistration = onCall(
  async (
    request: CallableRequest<ConfirmRegistrationInput>,
  ): Promise<ConfirmRegistrationOutput> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.')
    }
    const callerUid = request.auth.uid
    const { registrationId } = parseInput(request.data)

    const userSnap = await db().doc(`users/${callerUid}`).get()
    if (!userSnap.exists) {
      throw new HttpsError('permission-denied', 'No /users doc for caller.')
    }
    const userData = userSnap.data() as UserData

    const registrationRef = db().doc(`registrations/${registrationId}`)
    let resolvedMemberId = ''
    let memberCreated = false

    await db().runTransaction(async (tx) => {
      const regSnap = await tx.get(registrationRef)
      if (!regSnap.exists) {
        throw new HttpsError('not-found', `registration ${registrationId} not found`)
      }
      const reg = regSnap.data() as RegistrationData

      assertCoachOrAdmin(userData, reg.teamId)

      if (reg.status !== 'trial_in_progress') {
        throw new HttpsError(
          'failed-precondition',
          `cannot confirm registration in status '${reg.status}' — must be 'trial_in_progress'`,
        )
      }

      const teamRef = db().doc(`teams/${reg.teamId}`)
      const teamSnap = await tx.get(teamRef)
      if (!teamSnap.exists) {
        throw new HttpsError('internal', `team ${reg.teamId} disappeared`)
      }
      const team = teamSnap.data() as TeamData

      const now = Timestamp.now()

      // 1. Résoudre / créer le member.
      //    Si on réutilise un member existant, on lit son state actuel pour
      //    décider s'il faut binder le submitter (`existingMember` non-null).
      //    Tous les `tx.get` doivent rester en amont des `tx.set`/`tx.update`
      //    (contrainte transactions Firestore).
      //
      //    Pour `for: 'self'`, on lit aussi `users/{submittedByUid}` ici
      //    (read en amont du premier write) pour pouvoir poser le linking
      //    inverse `user.memberId` plus bas, sans avoir à séquencer en deux
      //    transactions. Cf. bloc "linking inverse" après le bloc 1.5.
      const submitterUserRef = db().doc(`users/${reg.submittedByUid}`)
      const submitterUserSnap =
        reg.registrationFor === 'self' ? await tx.get(submitterUserRef) : null

      let memberId: string
      let existingMember: MemberData | null = null

      if (reg.matchedMemberId) {
        memberId = reg.matchedMemberId
        const memberSnap = await tx.get(db().doc(`members/${memberId}`))
        if (memberSnap.exists) {
          existingMember = memberSnap.data() as MemberData
        }
        // Si le member a été supprimé entre submit et confirm (cas marginal),
        // existingMember reste null → on re-rattache la team et on update
        // registration, mais on ne tente pas de binding (rien à écrire).
      } else {
        // Défense en profondeur : refaire un match strict avant de créer. Le
        // wizard parent peut avoir manqué le match (utilisateur a sauté l'étape,
        // ou member créé par un coach en "essai" après la soumission). Sans ce
        // filet, on créerait un doublon à chaque confirmation.
        const existingMemberId = await findExactMemberMatch(tx, reg.player)
        if (existingMemberId) {
          memberId = existingMemberId
          const memberSnap = await tx.get(db().doc(`members/${memberId}`))
          if (memberSnap.exists) {
            existingMember = memberSnap.data() as MemberData
          }
          // memberCreated reste false — c'est un member pré-existant qu'on
          // rattache simplement à la team.
        } else {
          const memberRef = db().collection('members').doc()
          memberId = memberRef.id
          memberCreated = true

          const memberData: MemberData = {
            firstName: reg.player.firstName,
            lastName: reg.player.lastName,
            roles: ['player'],
            linkedUserId:
              reg.registrationFor === 'self' ? reg.submittedByUid : null,
            licenseNumber: '',
            officialLevel: null,
            coachLevel: null,
            officialLicense: null,
            coachLicense: null,
            licensed: false,
            duesStatus: 'n/a',  // sera flippé par `initiateDuesOnPlayerActivation`
            duesStatusUpdatedAt: now,
            active: true,
            status: 'active',
            archivedAt: null,
            archivedReason: null,
            archivedByUid: null,
            birthDate: reg.player.birthDate,
            guardianUserIds:
              reg.registrationFor === 'dependent' ? [reg.submittedByUid] : [],
            comms: defaultComms(reg.player.birthDate, now, reg.registrationFor),
            avs: reg.player.avs,
            transferState: reg.foreignTransfer ? 'international_pending' : 'none',
            // Photo licence — posée plus tard par la callable
            // setMemberLicensePhoto (cf. docs/members/license-photo.md).
            photoStoragePath: null,
            photoUpdatedAt: null,
            photoUpdatedByUid: null,
          }
          tx.set(memberRef, memberData)
        }
      }
      resolvedMemberId = memberId

      // 1.5 Binding submitter ↔ existing member (pas applicable si on vient
      //     de créer le member ci-dessus : le binding y est déjà câblé via
      //     `memberData.linkedUserId` / `guardianUserIds`).
      //
      //     Sans ce binding, les rules `/dues` refusent au submitter la lecture
      //     de la cotisation qui va être créée par `initiateDuesOnPlayerActivation`
      //     → l'app register reste vide alors qu'une cotisation existe.
      //     La réactivation (member inactif/archivé qui se réinscrit) est
      //     fusionnée dans le MÊME objet de patch que le binding : un seul
      //     `tx.update` par memberRef. On n'écrit que si le patch est non-vide.
      if (existingMember && !memberCreated) {
        const memberRef = db().doc(`members/${memberId}`)
        const patch: Record<string, unknown> = {}

        // Binding submitter ↔ member.
        if (reg.registrationFor === 'dependent') {
          const currentGuardians = existingMember.guardianUserIds ?? []
          if (!currentGuardians.includes(reg.submittedByUid)) {
            patch.guardianUserIds = admin.firestore.FieldValue.arrayUnion(
              reg.submittedByUid,
            )
          }
        } else {
          // `for: 'self'` — joueur majeur s'inscrivant pour lui-même.
          if (existingMember.linkedUserId == null) {
            patch.linkedUserId = reg.submittedByUid
          } else if (existingMember.linkedUserId !== reg.submittedByUid) {
            // Member déjà lié à un AUTRE compte → on ne touche pas (préserve
            // le binding existant). Le submitter ne verra pas la cotisation
            // côté register ; à régler manuellement par un admin.
            logger.warn(
              'confirmRegistration: existing member already linked to another user',
              {
                registrationId,
                memberId,
                existingLinkedUserId: existingMember.linkedUserId,
                submittedByUid: reg.submittedByUid,
              },
            )
          }
        }

        // Réactivation : un membre inactif ou archivé qui se réinscrit via le
        // portail register reprend l'accès. Idempotent — on ne pose les champs
        // que si une réactivation est réellement nécessaire (évite un write
        // inutile quand le member est déjà actif).
        const needsReactivation =
          existingMember.active === false || existingMember.status === 'archived'
        if (needsReactivation) {
          patch.active = true
          patch.status = 'active'
          patch.archivedAt = null
          patch.archivedReason = null
          patch.archivedByUid = null
          logger.info('confirmRegistration: reactivating inactive/archived member', {
            registrationId,
            memberId,
            previousActive: existingMember.active,
            previousStatus: existingMember.status,
          })
        }

        if (Object.keys(patch).length > 0) {
          tx.update(memberRef, patch as FirebaseFirestore.UpdateData<MemberData>)
        }
      }

      // 1.6 Linking inverse `user.memberId` (forward-fix du TODO ligne 52).
      //
      //     Sans ce binding inverse, l'app `courtbase-register` ne pouvait
      //     pas lire les cotisations du membre via la query `memberId in [...]`
      //     (la rule `/dues` autorise via `member.linkedUserId` mais le repo
      //     register passe par `user.memberId` pour résoudre les memberIds
      //     accessibles). Symptôme : factures introuvables pour un joueur
      //     majeur qui s'est inscrit pour lui-même.
      //
      //     Posé uniquement pour `for: 'self'` (le submitter EST le joueur).
      //     Pour `for: 'dependent'` le parent conserve son propre `memberId`
      //     (s'il en a un) et le lien passe par `member.guardianUserIds`.
      //
      //     Idempotent : skip si `user.memberId` est déjà = memberId. Si
      //     l'user est déjà lié à un AUTRE member, on log et on ne touche
      //     pas (préservation du binding existant — cohérent avec le warn
      //     côté member ci-dessus).
      if (submitterUserSnap && submitterUserSnap.exists) {
        const submitterData = submitterUserSnap.data() as UserData
        const currentLinkedMember = submitterData.memberId
        if (currentLinkedMember == null || currentLinkedMember === '') {
          tx.update(submitterUserRef, { memberId })
        } else if (currentLinkedMember !== memberId) {
          logger.warn(
            'confirmRegistration: submitter user.memberId already set to another member, skipping inverse binding',
            {
              registrationId,
              submittedByUid: reg.submittedByUid,
              currentMemberId: currentLinkedMember,
              newMemberId: memberId,
            },
          )
        }
        // else : déjà lié au bon member, no-op (idempotent).
      }

      // 2. Ajouter le member au team.playerIds (déclenche dues trigger).
      tx.update(teamRef, {
        playerIds: admin.firestore.FieldValue.arrayUnion(memberId),
      })
      // Lecture défensive du champ pour silence le linter type unused.
      void team

      // 3. Update registration.
      const note = memberCreated
        ? `confirmed → member ${memberId} created`
        : `confirmed → existing member ${memberId}`
      const action: RegistrationActionLogEntry = {
        at: now,
        byUid: callerUid,
        action: 'status_changed',
        previousStatus: reg.status,
        newStatus: 'confirmed_pending_dues',
        note,
      }
      tx.update(registrationRef, {
        status: 'confirmed_pending_dues',
        statusUpdatedAt: now,
        matchedMemberId: memberId,
        actionLog: [...(reg.actionLog ?? []), action],
      })
    })

    logger.info('confirmRegistration: ok', {
      registrationId,
      callerUid,
      memberId: resolvedMemberId,
      memberCreated,
    })

    // Notif submitter (hors transaction — ne pas bloquer la confirmation).
    void serverTimestamp() // imported for future notif/email enqueue

    return {
      ok: true,
      registrationId,
      memberId: resolvedMemberId,
      memberCreated,
      status: 'confirmed_pending_dues',
    }
  },
)
