/**
 * Tests pour le trigger `syncUserRolesFromMember`. Vérifie la propagation
 * `member.roles` → `/users/{linkedUserId}.roles` : sync, délien (roles vidés),
 * relien, idempotence, court-circuit, user doc manquant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeUserDoc {
  roles?: string[]
}

const fakeUsers = new Map<string, FakeUserDoc>()
const updateSpy = vi.fn()

function makeUserRef(path: string) {
  return {
    path,
    get: vi.fn(async () => {
      const data = fakeUsers.get(path)
      return { exists: data != null, data: () => data };
    }),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      updateSpy(path, patch)
      const existing = fakeUsers.get(path) ?? {}
      fakeUsers.set(path, { ...existing, ...(patch as FakeUserDoc) })
    }),
  }
}

const fakeDb = { doc: vi.fn((path: string) => makeUserRef(path)) }

vi.mock('../registrations/_helpers', () => ({ db: () => fakeDb }))

interface TriggerHandler {
  run: (event: unknown) => Promise<unknown>
}

let mod: typeof import('./syncUserRolesFromMember')

/** Construit un faux snapshot membre. `null` => doc absent (create/delete). */
function memberSnap(data: Record<string, unknown> | null) {
  return { exists: data != null, data: () => data ?? undefined }
}

function event(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  return { data: { before: memberSnap(before), after: memberSnap(after) } }
}

beforeEach(async () => {
  vi.clearAllMocks()
  fakeUsers.clear()
  mod = await import('./syncUserRolesFromMember')
})
afterEach(() => vi.restoreAllMocks())

async function run(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  const handler = mod.syncUserRolesFromMember as unknown as TriggerHandler
  await handler.run(event(before, after))
}

describe('syncUserRolesFromMember', () => {
  it('pushes member roles to the linked user on a roles change', async () => {
    fakeUsers.set('users/u-1', { roles: ['player'] })
    await run(
      { linkedUserId: 'u-1', roles: ['player'] },
      { linkedUserId: 'u-1', roles: ['player', 'coach', 'official'] },
    )
    expect(updateSpy).toHaveBeenCalledWith('users/u-1', {
      roles: ['player', 'coach', 'official'],
    })
  })

  it('pushes roles on member creation with a linked user', async () => {
    fakeUsers.set('users/u-1', { roles: [] })
    await run(null, { linkedUserId: 'u-1', roles: ['coach'] })
    expect(updateSpy).toHaveBeenCalledWith('users/u-1', { roles: ['coach'] })
  })

  it('clears the old user roles when the member is unlinked', async () => {
    fakeUsers.set('users/u-1', { roles: ['coach'] })
    await run(
      { linkedUserId: 'u-1', roles: ['coach'] },
      { linkedUserId: null, roles: ['coach'] },
    )
    expect(updateSpy).toHaveBeenCalledWith('users/u-1', { roles: [] })
  })

  it('clears the old user and fills the new one on relink', async () => {
    fakeUsers.set('users/u-1', { roles: ['coach'] })
    fakeUsers.set('users/u-2', { roles: [] })
    await run(
      { linkedUserId: 'u-1', roles: ['coach'] },
      { linkedUserId: 'u-2', roles: ['coach'] },
    )
    expect(updateSpy).toHaveBeenCalledWith('users/u-1', { roles: [] })
    expect(updateSpy).toHaveBeenCalledWith('users/u-2', { roles: ['coach'] })
  })

  it('clears the user roles when the member is deleted', async () => {
    fakeUsers.set('users/u-1', { roles: ['official'] })
    await run({ linkedUserId: 'u-1', roles: ['official'] }, null)
    expect(updateSpy).toHaveBeenCalledWith('users/u-1', { roles: [] })
  })

  it('is a no-op when neither link nor roles changed', async () => {
    fakeUsers.set('users/u-1', { roles: ['coach'] })
    await run(
      { linkedUserId: 'u-1', roles: ['coach'], firstName: 'A' },
      { linkedUserId: 'u-1', roles: ['coach'], firstName: 'B' },
    )
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('is idempotent — no write when user roles already match', async () => {
    fakeUsers.set('users/u-1', { roles: ['coach', 'official'] })
    await run(
      { linkedUserId: 'u-1', roles: ['coach'] },
      { linkedUserId: 'u-1', roles: ['official', 'coach'] },
    )
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does not crash when the linked user doc is missing', async () => {
    await run(null, { linkedUserId: 'ghost', roles: ['coach'] })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('does nothing for an unlinked member', async () => {
    await run(
      { linkedUserId: null, roles: ['player'] },
      { linkedUserId: null, roles: ['player', 'coach'] },
    )
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
