// Enable the Basketplan integration on a Firebase project.
//
// Usage:
//   npm run enable:basketplan -w functions -- --project <projectId> [--clubId 60] [--federationId 9] [--dry-run]
//
// Auth (Application Default Credentials, either of):
//   gcloud auth application-default login
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//
// Effect: upserts /config/club.basketplan = { enabled: true, clubId, defaultFederationId,
// lastSyncAt: null, lastSyncError: null }. Idempotent. Use --dry-run to inspect
// the patch without writing. The scheduled `scheduledBasketplanSync` cron does
// a no-op when `enabled !== true`, so this seed is mandatory before the first
// nightly run.

import * as admin from 'firebase-admin'

const USAGE = `Usage:
  enableBasketplan --project <projectId> [--clubId <n>] [--federationId <n>] [--dry-run]

Flags:
  --project <id>        Target Firebase project ID (required)
  --clubId <n>          Basketplan clubId (default: 60 = Marly Basket)
  --federationId <n>    Default Basketplan federationId (default: 9 = AFBB Fribourg)
  --dry-run             Print the patch without writing
  -h, --help            Show this help

Auth:
  gcloud auth application-default login
  or  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json`

interface ParsedArgs {
  projectId: string
  clubId: number
  federationId: number
  dryRun: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  let projectId = ''
  let clubId = 60
  let federationId = 9
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      console.log(USAGE)
      process.exit(0)
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length)
    } else if (arg === '--project') {
      projectId = argv[++i] ?? ''
    } else if (arg.startsWith('--clubId=')) {
      clubId = Number(arg.slice('--clubId='.length))
    } else if (arg === '--clubId') {
      clubId = Number(argv[++i] ?? '')
    } else if (arg.startsWith('--federationId=')) {
      federationId = Number(arg.slice('--federationId='.length))
    } else if (arg === '--federationId') {
      federationId = Number(argv[++i] ?? '')
    }
  }

  if (!projectId) {
    console.error('error: --project is required\n')
    console.error(USAGE)
    process.exit(2)
  }
  if (!Number.isFinite(clubId) || clubId <= 0) {
    console.error(`error: invalid --clubId "${clubId}"`)
    process.exit(2)
  }
  if (!Number.isFinite(federationId) || federationId <= 0) {
    console.error(`error: invalid --federationId "${federationId}"`)
    process.exit(2)
  }
  return { projectId, clubId, federationId, dryRun }
}

async function main(): Promise<void> {
  const { projectId, clubId, federationId, dryRun } = parseArgs(
    process.argv.slice(2),
  )

  admin.initializeApp({ projectId })
  const db = admin.firestore()
  const ref = db.doc('config/club')

  const snap = await ref.get()
  const existing = (snap.exists ? snap.data() : {}) as Record<string, unknown>
  const existingBasketplan =
    (existing.basketplan as Record<string, unknown> | undefined) ?? {}

  const nextBasketplan = {
    enabled: true,
    clubId,
    defaultFederationId: federationId,
    // Preserve sync state if already populated, otherwise null.
    lastSyncAt: existingBasketplan.lastSyncAt ?? null,
    lastSyncError: existingBasketplan.lastSyncError ?? null,
  }

  console.log(`[enableBasketplan] project=${projectId}`)
  console.log('[enableBasketplan] current basketplan:', existingBasketplan)
  console.log('[enableBasketplan] next basketplan:   ', nextBasketplan)

  if (dryRun) {
    console.log('[enableBasketplan] --dry-run → no write')
    return
  }

  await ref.set({ basketplan: nextBasketplan }, { merge: true })
  console.log('[enableBasketplan] /config/club.basketplan written ✓')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[enableBasketplan] failed:', err)
    process.exit(1)
  })
