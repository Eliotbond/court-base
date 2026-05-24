// One-shot : backfill `/dues/{id}.registeredByUid` pour les cotisations
// créées avant le déploiement de `initiateDuesOnPlayerActivation` (qui pose
// ce champ depuis le 2026-05-18).
//
// Pourquoi : la rule `/dues` autorise le caller à lire ses cotisations via
// deux clauses :
//   (a) get(/members/{due.memberId}).data.linkedUserId == auth.uid
//   (b) resource.data.get('registeredByUid', null) == auth.uid
//
// La clause (a) fait un `get()` Firestore au runtime, que Firestore ne peut
// PAS pré-valider statiquement → il rejette la LIST query
// `where memberId in [...]` en `permission-denied`.
// La clause (b) est statiquement pré-validable (simple comparaison sur
// `resource.data.registeredByUid`) → la LIST query
// `where registeredByUid == auth.uid` passe.
//
// Conséquence : les cotisations qui n'ont pas `registeredByUid` posé sont
// inatteignables depuis l'app register, même quand l'utilisateur a le droit
// de les lire en théorie (member lié / tuteur).
//
// Ce script résout le legacy en posant `registeredByUid` à partir de
// `member.linkedUserId` (cas `for: 'self'`) ou du premier guardian. Lookup
// best-effort : si on ne peut pas inférer, on log et on skip (la due reste
// invisible côté register, mais l'admin peut quand même la traiter).
//
// Usage :
//   npm run backfill:dues-registered-by-uid -w @club-app/functions -- --project <projectId>
//   npm run backfill:dues-registered-by-uid -w @club-app/functions -- --project=<projectId> --dry-run
//
// Auth :
//   gcloud auth application-default login
//   ou GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//
// Idempotent : skip les dues qui ont déjà `registeredByUid` non-null.

import * as admin from 'firebase-admin'

const USAGE = `Usage:
  backfillDuesRegisteredByUid --project <projectId> [--dry-run]

Flags:
  --project <id>   Target Firebase project ID (required)
  --dry-run        Log only, do not write
  -h, --help       Show this help`

interface ParsedArgs {
  projectId: string
  dryRun: boolean
}

function dieWithUsage(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`)
  process.exit(1)
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let projectId: string | undefined
  let dryRun = false
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '-h' || a === '--help') {
      console.log(USAGE)
      process.exit(0)
    }
    if (a === '--dry-run') {
      dryRun = true
      continue
    }
    if (a === '--project') {
      const next = args[i + 1]
      if (!next) dieWithUsage('--project requires a value')
      projectId = next
      i += 1
      continue
    }
    if (a?.startsWith('--project=')) {
      projectId = a.slice('--project='.length)
      continue
    }
    dieWithUsage(`Unknown argument: ${a}`)
  }
  if (!projectId) dieWithUsage('--project is required')
  return { projectId, dryRun }
}

async function main(): Promise<void> {
  const { projectId, dryRun } = parseArgs(process.argv.slice(2))

  admin.initializeApp({ projectId })
  const db = admin.firestore()

  console.log(`[backfill-dues] project=${projectId} dryRun=${dryRun}`)
  const snap = await db.collection('dues').get()
  console.log(`[backfill-dues] scanning ${snap.size} dues`)

  let alreadyOk = 0
  let updated = 0
  let inferredFromLinked = 0
  let inferredFromGuardian = 0
  let inferredFromRegistration = 0
  let cannotInfer = 0

  for (const dueDoc of snap.docs) {
    const dueData = dueDoc.data() as {
      registeredByUid?: string | null
      memberId: string
    }
    if (dueData.registeredByUid) {
      alreadyOk += 1
      continue
    }

    // Priorité 1 : registration qui a déclenché la création (matchedMemberId).
    let resolvedUid: string | null = null
    let source: 'registration' | 'linkedUserId' | 'guardian' | null = null

    const regSnap = await db
      .collection('registrations')
      .where('matchedMemberId', '==', dueData.memberId)
      .limit(1)
      .get()
    if (!regSnap.empty) {
      const reg = regSnap.docs[0]?.data() as { submittedByUid?: string }
      if (reg.submittedByUid) {
        resolvedUid = reg.submittedByUid
        source = 'registration'
        inferredFromRegistration += 1
      }
    }

    // Priorité 2 : member.linkedUserId (cas 'for: self' sans registration).
    if (!resolvedUid) {
      const memberSnap = await db.doc(`members/${dueData.memberId}`).get()
      if (memberSnap.exists) {
        const memberData = memberSnap.data() as {
          linkedUserId?: string | null
          guardianUserIds?: string[]
        }
        if (memberData.linkedUserId) {
          resolvedUid = memberData.linkedUserId
          source = 'linkedUserId'
          inferredFromLinked += 1
        } else if (
          memberData.guardianUserIds &&
          memberData.guardianUserIds.length > 0
        ) {
          // Priorité 3 : premier guardian (best-effort pour les cas
          // 'for: dependent' sans registration retrouvable).
          resolvedUid = memberData.guardianUserIds[0] ?? null
          source = 'guardian'
          inferredFromGuardian += 1
        }
      }
    }

    if (!resolvedUid) {
      console.warn(
        `[backfill-dues] cannot infer registeredByUid for due=${dueDoc.id} member=${dueData.memberId} — skipping`,
      )
      cannotInfer += 1
      continue
    }

    if (dryRun) {
      console.log(
        `[backfill-dues] DRY would update due=${dueDoc.id} registeredByUid=${resolvedUid} (source=${source})`,
      )
    } else {
      await dueDoc.ref.update({ registeredByUid: resolvedUid })
      console.log(
        `[backfill-dues] updated due=${dueDoc.id} registeredByUid=${resolvedUid} (source=${source})`,
      )
    }
    updated += 1
  }

  console.log(
    `[backfill-dues] done. updated=${updated} alreadyOk=${alreadyOk} inferredFromRegistration=${inferredFromRegistration} inferredFromLinked=${inferredFromLinked} inferredFromGuardian=${inferredFromGuardian} cannotInfer=${cannotInfer}`,
  )
}

main().catch((err: unknown) => {
  console.error('[backfill-dues] fatal:', err)
  process.exit(1)
})
