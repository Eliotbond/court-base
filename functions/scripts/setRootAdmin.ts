// Bootstrap: grant or revoke the rootAdmin custom claim on a Firebase Auth user.
//
// Usage:
//   npm run bootstrap:root-admin -w functions -- --project <projectId> <email> [--revoke]
//   npm run bootstrap:root-admin -w functions -- --project=<projectId> --email=<email> [--revoke]
//   npm run bootstrap:root-admin -w functions -- --help
//
// Auth (Application Default Credentials, either of):
//   gcloud auth application-default login
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
//
// This is a one-shot, per-project bootstrap. The deployed setRootAdminClaim
// Function requires an existing rootAdmin to operate, so a manual script is
// required to seed the very first one.

import * as admin from 'firebase-admin'

const USAGE = `Usage:
  setRootAdmin --project <projectId> <email> [--revoke]
  setRootAdmin --project=<projectId> --email=<email> [--revoke]

Flags:
  --project <id>   Target Firebase project ID (required)
  --email <addr>   Target user email (or pass as the single positional arg)
  --revoke         Remove the rootAdmin claim instead of granting it
  -h, --help       Show this help

Auth:
  gcloud auth application-default login
  or  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json`

interface ParsedArgs {
  projectId: string
  email: string
  revoke: boolean
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function dieWithUsage(message: string): never {
  console.error(`Error: ${message}\n\n${USAGE}`)
  process.exit(1)
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let projectId: string | undefined
  let emailFromFlag: string | undefined
  let revoke = false
  const positionals: string[] = []

  // Helper: when a flag takes a value, accept "--flag=value" or
  // "--flag value", and reject when the next token is another flag.
  const takeValue = (
    name: string,
    i: number,
    inlineValue: string | undefined,
  ): { value: string; nextIndex: number } => {
    if (inlineValue !== undefined) {
      if (inlineValue === '') dieWithUsage(`${name} requires a non-empty value`)
      return { value: inlineValue, nextIndex: i }
    }
    const next = args[i + 1]
    if (next === undefined || next.startsWith('-')) {
      dieWithUsage(`${name} requires a value`)
    }
    return { value: next, nextIndex: i + 1 }
  }

  for (let i = 0; i < args.length; i++) {
    const raw = args[i]

    if (raw === '-h' || raw === '--help') {
      console.log(USAGE)
      process.exit(0)
    }

    if (raw === '--revoke') {
      revoke = true
      continue
    }

    if (raw === '--project' || raw.startsWith('--project=')) {
      const inline = raw.startsWith('--project=') ? raw.slice('--project='.length) : undefined
      const { value, nextIndex } = takeValue('--project', i, inline)
      projectId = value
      i = nextIndex
      continue
    }

    if (raw === '--email' || raw.startsWith('--email=')) {
      const inline = raw.startsWith('--email=') ? raw.slice('--email='.length) : undefined
      const { value, nextIndex } = takeValue('--email', i, inline)
      emailFromFlag = value
      i = nextIndex
      continue
    }

    if (raw.startsWith('-')) {
      dieWithUsage(`unknown flag "${raw}"`)
    }

    positionals.push(raw)
  }

  if (positionals.length > 1) {
    dieWithUsage(`unexpected extra argument "${positionals[1]}"`)
  }

  const email = emailFromFlag ?? positionals[0]
  if (!email) dieWithUsage('email is required (positional or --email)')
  if (!isEmail(email)) dieWithUsage(`"${email}" is not a valid email`)
  if (!projectId) dieWithUsage('--project <projectId> is required')

  return { projectId, email, revoke }
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  )
}

function looksLikeMissingCredentials(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /could not load the default credentials|application[- ]default credentials|metadata service|getaccesstoken/i.test(
    err.message,
  )
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

async function fetchUserOrExit(email: string): Promise<admin.auth.UserRecord> {
  try {
    return await admin.auth().getUserByEmail(email)
  } catch (err) {
    if (hasCode(err, 'auth/user-not-found')) {
      console.error(
        `Error: no Firebase Auth user with email "${email}".\n` +
          `Create the account first via the Firebase Console, or have the user sign in once with OAuth, then re-run.`,
      )
    } else if (looksLikeMissingCredentials(err)) {
      console.error(
        `Error: could not load Google credentials.\n` +
          `Run "gcloud auth application-default login", or set GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json.`,
      )
    } else {
      console.error(`Error: failed to fetch user (${stringifyErr(err)}).`)
    }
    process.exit(1)
  }
}

async function upsertUserDoc(
  uid: string,
  email: string,
  userRecord: admin.auth.UserRecord,
): Promise<void> {
  const ref = admin.firestore().collection('users').doc(uid)
  const snap = await ref.get()
  const existing: Record<string, unknown> = snap.exists ? (snap.data() ?? {}) : {}

  // Only fill fields that are absent. Never overwrite an existing value —
  // notably `roles` (operator may have curated them) and `createdAt`.
  const delta: Record<string, unknown> = {}
  if (existing.email === undefined) delta.email = email
  if (existing.displayName === undefined) {
    delta.displayName = userRecord.displayName ?? email
  }
  if (existing.photoURL === undefined) delta.photoURL = userRecord.photoURL ?? null
  if (!Array.isArray(existing.roles)) delta.roles = ['admin']
  if (existing.memberId === undefined) delta.memberId = null
  if (!Array.isArray(existing.teamIds)) delta.teamIds = []
  if (existing.createdAt === undefined) {
    delta.createdAt = admin.firestore.FieldValue.serverTimestamp()
  }

  if (Object.keys(delta).length > 0) {
    await ref.set(delta, { merge: true })
  }
}

async function main(): Promise<void> {
  const { projectId, email, revoke } = parseArgs(process.argv.slice(2))

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  })

  const user = await fetchUserOrExit(email)

  const nextClaims: Record<string, unknown> = { ...(user.customClaims ?? {}) }
  if (revoke) {
    delete nextClaims.rootAdmin
  } else {
    nextClaims.rootAdmin = true
  }
  await admin.auth().setCustomUserClaims(user.uid, nextClaims)

  if (!revoke) {
    await upsertUserDoc(user.uid, email, user)
  }

  if (revoke) {
    console.log(`OK: rootAdmin claim revoked for ${email} on project ${projectId}.`)
  } else {
    console.log(`OK: ${email} (uid: ${user.uid}) is now rootAdmin on project ${projectId}.`)
  }
}

main().catch((err: unknown) => {
  if (looksLikeMissingCredentials(err)) {
    console.error(
      `Error: could not load Google credentials.\n` +
        `Run "gcloud auth application-default login", or set GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json.`,
    )
  } else {
    console.error(`Unexpected error: ${stringifyErr(err)}`)
  }
  process.exitCode = 1
})
