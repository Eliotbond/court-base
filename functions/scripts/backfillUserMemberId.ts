// One-shot : backfill `/users/{uid}.memberId` à partir de
// `/members where linkedUserId == <uid>` (mirror du binding posé côté member).
//
// Pourquoi : avant le forward-fix de `confirmRegistration` (2026-05-23), le
// flow d'inscription `for: 'self'` posait `member.linkedUserId` mais oubliait
// le miroir `user.memberId`. Conséquence : le repo `apps/courtbase-register`
// résolvait `auth.userDoc.memberId === null` et ne remontait pas les
// cotisations du membre dans "Mes factures" (l'utilisateur voyait un bandeau
// d'erreur ou une liste vide alors qu'une cotisation existait).
//
// Ce script :
//   1. Liste tous les `/members` du projet (≤ quelques centaines en pratique).
//   2. Pour chaque member ayant `linkedUserId` non-null :
//      - Lit `/users/{linkedUserId}`.
//      - Si `user.memberId` est null/vide → pose `user.memberId = member.id`.
//      - Si `user.memberId` est déjà = member.id → no-op (idempotent).
//      - Si `user.memberId` est = un AUTRE memberId → log warn et skip
//        (préservation du binding existant, à régler manuellement).
//
// Usage :
//   npm run backfill:user-member-id -w functions -- --project <projectId>
//   npm run backfill:user-member-id -w functions -- --project=<projectId> --dry-run
//
// Auth (Application Default Credentials, l'une des deux) :
//   gcloud auth application-default login
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//
// Idempotent : safe à relancer (les comptes déjà liés au bon member sont skip).

import * as admin from 'firebase-admin'

const USAGE = `Usage:
  backfillUserMemberId --project <projectId> [--dry-run]
  backfillUserMemberId --project=<projectId> [--dry-run]

Flags:
  --project <id>   Target Firebase project ID (required)
  --dry-run        Only log what would change, do not write
  -h, --help       Show this help

Auth:
  gcloud auth application-default login
  or  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json`

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

  console.log(`[backfill] project=${projectId} dryRun=${dryRun}`)
  const snap = await db.collection('members').get()
  console.log(`[backfill] scanning ${snap.size} members`)

  let candidates = 0
  let updated = 0
  let alreadyOk = 0
  let conflicts = 0
  let missingUser = 0

  for (const memberDoc of snap.docs) {
    const memberData = memberDoc.data() as { linkedUserId?: string | null }
    const linkedUserId = memberData.linkedUserId
    if (!linkedUserId) continue
    candidates += 1

    const userRef = db.doc(`users/${linkedUserId}`)
    const userSnap = await userRef.get()
    if (!userSnap.exists) {
      console.warn(
        `[backfill] member=${memberDoc.id} → user ${linkedUserId} not found (skipping)`,
      )
      missingUser += 1
      continue
    }
    const userData = userSnap.data() as { memberId?: string | null }
    const currentMemberId = userData.memberId

    if (currentMemberId === memberDoc.id) {
      alreadyOk += 1
      continue
    }
    if (currentMemberId && currentMemberId !== memberDoc.id) {
      console.warn(
        `[backfill] CONFLICT user=${linkedUserId} already linked to ${currentMemberId}, member=${memberDoc.id} wants the slot — skipping`,
      )
      conflicts += 1
      continue
    }

    if (dryRun) {
      console.log(
        `[backfill] DRY would update user=${linkedUserId} memberId=null → ${memberDoc.id}`,
      )
    } else {
      await userRef.update({ memberId: memberDoc.id })
      console.log(
        `[backfill] updated user=${linkedUserId} memberId=${memberDoc.id}`,
      )
    }
    updated += 1
  }

  console.log(
    `[backfill] done. candidates=${candidates} updated=${updated} alreadyOk=${alreadyOk} conflicts=${conflicts} missingUser=${missingUser}`,
  )
}

main().catch((err: unknown) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
