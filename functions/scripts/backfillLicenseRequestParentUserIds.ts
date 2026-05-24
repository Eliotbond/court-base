// One-shot : backfill `/licenseRequests/{id}.parentUserIds` pour les
// demandes créées avant le déploiement de l'ancrage statique (2026-05-24).
//
// Pourquoi : la rule `read` `/licenseRequests` autorise le parent à lire ses
// demandes via deux clauses :
//   (a) get(/members/{lr.memberId}).data.guardianUserIds contains auth.uid
//       (via le helper `isGuardianOf`)
//   (b) request.auth.uid in resource.data.get('parentUserIds', [])
//
// La clause (a) fait un `get()` cross-doc dynamique : Firestore peut refuser
// la LIST query `where parentUserIds array-contains uid` (et même `where
// memberId in [...]`) parce qu'elle ne peut pas pré-valider la rule
// statiquement → permission-denied silencieux côté register, banner Home vide.
// La clause (b) est statiquement pré-validable → la LIST query passe.
//
// Conséquence : les demandes créées AVANT que `parentUserIds` ne soit posé à
// la création (i.e. avant cette PR) sont inatteignables depuis l'app
// register. Ce script les remet d'aplomb en posant `parentUserIds` =
// `member.linkedUserId` ∪ `member.guardianUserIds` (snapshot au moment du
// backfill — si les guardians changent ensuite, ne suit pas).
//
// Usage :
//   npm run backfill:license-request-parent-user-ids -w @club-app/functions -- --project <projectId>
//   npm run backfill:license-request-parent-user-ids -w @club-app/functions -- --project=<projectId> --dry-run
//
// Auth :
//   gcloud auth application-default login
//   ou GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//
// Idempotent : skip les demandes qui ont déjà `parentUserIds` non vide.

import * as admin from 'firebase-admin'

const USAGE = `Usage:
  backfillLicenseRequestParentUserIds --project <projectId> [--dry-run]

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

  console.log(
    `[backfill-lr-parent-user-ids] project=${projectId} dryRun=${dryRun}`,
  )
  const snap = await db.collection('licenseRequests').get()
  console.log(`[backfill-lr-parent-user-ids] scanning ${snap.size} requests`)

  let alreadyOk = 0
  let updated = 0
  let memberNotFound = 0
  let noUserIds = 0

  for (const lrDoc of snap.docs) {
    const lrData = lrDoc.data() as {
      parentUserIds?: string[]
      memberId?: string
    }
    if (lrData.parentUserIds && lrData.parentUserIds.length > 0) {
      alreadyOk += 1
      continue
    }
    if (!lrData.memberId) {
      console.warn(
        `[backfill-lr-parent-user-ids] lr=${lrDoc.id} has no memberId — skipping`,
      )
      noUserIds += 1
      continue
    }

    const memberSnap = await db.doc(`members/${lrData.memberId}`).get()
    if (!memberSnap.exists) {
      console.warn(
        `[backfill-lr-parent-user-ids] lr=${lrDoc.id} member=${lrData.memberId} not found — skipping`,
      )
      memberNotFound += 1
      continue
    }
    const memberData = memberSnap.data() as {
      linkedUserId?: string | null
      guardianUserIds?: string[]
    }

    const uids = new Set<string>()
    if (memberData.linkedUserId) uids.add(memberData.linkedUserId)
    for (const g of memberData.guardianUserIds ?? []) uids.add(g)

    if (uids.size === 0) {
      console.warn(
        `[backfill-lr-parent-user-ids] lr=${lrDoc.id} member=${lrData.memberId} has no linkedUserId nor guardianUserIds — posing [] (parent inaccessible)`,
      )
      noUserIds += 1
      // On pose quand même `[]` pour empêcher le script de revisiter ce doc.
      if (!dryRun) {
        await lrDoc.ref.update({ parentUserIds: [] })
      }
      continue
    }

    const arr = Array.from(uids)
    if (dryRun) {
      console.log(
        `[backfill-lr-parent-user-ids] DRY would update lr=${lrDoc.id} parentUserIds=${JSON.stringify(arr)}`,
      )
    } else {
      await lrDoc.ref.update({ parentUserIds: arr })
      console.log(
        `[backfill-lr-parent-user-ids] updated lr=${lrDoc.id} parentUserIds=${JSON.stringify(arr)}`,
      )
    }
    updated += 1
  }

  console.log(
    `[backfill-lr-parent-user-ids] done. updated=${updated} alreadyOk=${alreadyOk} memberNotFound=${memberNotFound} noUserIds=${noUserIds}`,
  )
}

main().catch((err: unknown) => {
  console.error('[backfill-lr-parent-user-ids] fatal:', err)
  process.exit(1)
})
