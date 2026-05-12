/**
 * Bootstrap script: set the first rootAdmin custom claim per Firebase project.
 *
 * This is a one-time out-of-band operation, NOT a deployed Cloud Function.
 * It requires a service-account JSON (referenced by GOOGLE_APPLICATION_CREDENTIALS env var)
 * and is run locally by an operator to seed the very first rootAdmin before any other
 * rootAdmin operations are possible (since setRootAdminClaim Function requires existing rootAdmin).
 *
 * Usage (from functions/ directory):
 *   npx ts-node scripts/setRootAdmin.ts <email> [--revoke]
 *
 * Or after build:
 *   node ./lib/scripts/setRootAdmin.js <email> [--revoke]
 */

import * as admin from 'firebase-admin'

const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const main = async (): Promise<void> => {
  // Check GOOGLE_APPLICATION_CREDENTIALS
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('[bootstrap] Error: GOOGLE_APPLICATION_CREDENTIALS env var is not set.')
    console.error('[bootstrap] Set it to point at a service-account JSON file.')
    process.exit(1)
  }

  // Parse CLI args
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('[bootstrap] Usage: setRootAdmin.ts <email> [--revoke]')
    process.exit(1)
  }

  const email = args[0]
  const revoke = args.includes('--revoke')
  const value = !revoke

  // Validate email
  if (!validateEmail(email)) {
    console.error(`[bootstrap] Error: "${email}" is not a valid email address.`)
    process.exit(1)
  }

  // Initialize Admin SDK with application-default credentials
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  })

  const auth = admin.auth()

  // Fetch user by email
  let userRecord: admin.auth.UserRecord
  try {
    userRecord = await auth.getUserByEmail(email)
  } catch (err) {
    console.error(`[bootstrap] Error: No user found for email ${email}.`)
    process.exit(1)
  }

  // Merge existing custom claims with rootAdmin
  const existingClaims = userRecord.customClaims ?? {}
  const nextClaims = { ...existingClaims, rootAdmin: value }

  // Set custom claims
  await auth.setCustomUserClaims(userRecord.uid, nextClaims)

  // Success
  console.log(`[bootstrap] set rootAdmin=${value} for ${email} (uid: ${userRecord.uid})`)
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('[bootstrap] Unexpected error:', err)
  process.exit(1)
})
