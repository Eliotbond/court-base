/**
 * Tests du sender — idempotence, validation, normalisation des recipients,
 * gestion erreurs. Mock complet de `transport` (pas de vraie connexion
 * SMTP) et de Firestore (pas d'emulator).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const fakeDocRefs = new Map<string, {
  update: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}>()

const fakeDb = {
  doc: vi.fn((path: string) => {
    if (!fakeDocRefs.has(path)) {
      fakeDocRefs.set(path, {
        update: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
      })
    }
    return fakeDocRefs.get(path)!
  }),
}

vi.mock('../_db', () => ({
  db: () => fakeDb,
  serverTimestamp: () => '__SERVER_TS__',
  FieldValue: {
    increment: (n: number) => ({ __increment: n }),
  },
}))

interface SendMailArgs {
  to: readonly string[]
  subject: string
  html: string
  text: string
}
interface SendMailResult {
  messageId: string
  accepted: readonly string[]
  rejected: readonly string[]
}

const sendMailMock = vi.fn<(args: SendMailArgs) => Promise<SendMailResult>>()

vi.mock('../transport', () => ({
  sendMail: (args: SendMailArgs) => sendMailMock(args),
  EMAIL_SECRETS: [],
}))

// Import APRÈS les mocks pour qu'ils s'appliquent.
let senderMod: typeof import('../sender')

// On rappelle la handler interne en réinventant l'event shape — la signature
// d'une CloudEvent v2 firestore est `{ data: snap, params: { emailId } }`.
// On accède au handler via l'export `emailSender.run` exposé par
// firebase-functions v2.
type SenderHandler = (event: {
  data: { data: () => unknown } | undefined
  params: { emailId: string }
}) => Promise<void> | void

let handler: SenderHandler

beforeEach(async () => {
  vi.clearAllMocks()
  fakeDocRefs.clear()
  sendMailMock.mockReset()
  senderMod = await import('../sender')
  // firebase-functions v2 expose la handler via `.run` (CloudEvent shim).
  // Si `run` n'est pas exposé selon la version, on accède au handler via
  // une cast — c'est interne mais stable sur v6.
  handler = (senderMod.emailSender as unknown as { run: SenderHandler }).run
})

afterEach(() => {
  vi.restoreAllMocks()
})

function buildSnap(data: unknown) {
  return { data: () => data }
}

function buildEvent(emailId: string, data: unknown) {
  return {
    data: data === undefined ? undefined : buildSnap(data),
    params: { emailId },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emailSender — idempotence', () => {
  it('skips when status is already "sent"', async () => {
    await handler(buildEvent('e1', {
      template: 'registration_submitted_confirm',
      to: ['x@y.com'],
      context: {},
      status: 'sent',
      sentAt: { seconds: 1, nanoseconds: 0 },
    }))

    expect(sendMailMock).not.toHaveBeenCalled()
    // Le handler ne doit pas avoir touché Firestore — donc aucun doc ref
    // n'a été créé via le proxy.
    expect(fakeDocRefs.has('pendingEmails/e1')).toBe(false)
  })

  it('skips when sentAt is set even without status', async () => {
    await handler(buildEvent('e2', {
      template: 'registration_submitted_confirm',
      to: ['x@y.com'],
      context: {},
      sentAt: { seconds: 1, nanoseconds: 0 },
    }))
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('skips when status is "failed" (no retry loop)', async () => {
    await handler(buildEvent('e3', {
      template: 'registration_submitted_confirm',
      to: ['x@y.com'],
      context: {},
      status: 'failed',
    }))
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe('emailSender — validation', () => {
  it('marks failed when no recipients resolved (null)', async () => {
    await handler(buildEvent('e4', {
      template: 'registration_submitted_confirm',
      to: null,
      context: {},
    }))

    expect(sendMailMock).not.toHaveBeenCalled()
    const ref = fakeDocRefs.get('pendingEmails/e4')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('no_recipients'),
    }))
  })

  it('marks failed when recipients array is empty', async () => {
    await handler(buildEvent('e5', {
      template: 'registration_submitted_confirm',
      to: [],
      context: {},
    }))

    const ref = fakeDocRefs.get('pendingEmails/e5')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('no_recipients'),
    }))
  })

  it('marks failed when template is unknown', async () => {
    await handler(buildEvent('e6', {
      template: 'totally_made_up_template',
      to: ['a@b.com'],
      context: {},
    }))

    expect(sendMailMock).not.toHaveBeenCalled()
    const ref = fakeDocRefs.get('pendingEmails/e6')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('unknown_template'),
    }))
  })

  it('marks failed when context shape is invalid (validator rejects)', async () => {
    await handler(buildEvent('e7', {
      template: 'registration_submitted_confirm',
      to: ['a@b.com'],
      // Missing required fields (no submittedByUid, etc.)
      context: { foo: 'bar' },
    }))

    expect(sendMailMock).not.toHaveBeenCalled()
    const ref = fakeDocRefs.get('pendingEmails/e7')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('invalid_context'),
    }))
  })
})

describe('emailSender — normalisation des recipients', () => {
  it('accepts a single string for `to` (legacy submitRegistration)', async () => {
    sendMailMock.mockResolvedValue({
      messageId: '<m1@plesk>',
      accepted: ['x@y.com'],
      rejected: [],
    })

    await handler(buildEvent('e8', {
      template: 'registration_submitted_confirm',
      to: 'x@y.com',
      context: {
        submittedByUid: 'u1',
        registrationId: 'r1',
        teamId: 't1',
        playerName: 'Alice',
        status: 'pending_payment',
      },
    }))

    expect(sendMailMock).toHaveBeenCalledOnce()
    const args = sendMailMock.mock.calls[0][0]
    expect(args.to).toEqual(['x@y.com'])
  })

  it('dedupes recipients while keeping order', async () => {
    sendMailMock.mockResolvedValue({
      messageId: '<m2@plesk>',
      accepted: ['a@b.com', 'c@d.com'],
      rejected: [],
    })

    await handler(buildEvent('e9', {
      template: 'registration_submitted_confirm',
      to: ['a@b.com', 'c@d.com', 'a@b.com', ' a@b.com '],
      context: {
        submittedByUid: 'u1',
        registrationId: 'r2',
        teamId: 't1',
        playerName: 'Bob',
        status: 'pending_payment',
      },
    }))

    const args = sendMailMock.mock.calls[0][0]
    expect(args.to).toEqual(['a@b.com', 'c@d.com'])
  })

  it('filters out invalid emails (no @)', async () => {
    sendMailMock.mockResolvedValue({
      messageId: '<m3@plesk>',
      accepted: ['a@b.com'],
      rejected: [],
    })

    await handler(buildEvent('e10', {
      template: 'registration_submitted_confirm',
      to: ['a@b.com', 'not-an-email', '', '  '],
      context: {
        submittedByUid: 'u1',
        registrationId: 'r3',
        teamId: 't1',
        playerName: 'Carol',
        status: 'pending_payment',
      },
    }))

    const args = sendMailMock.mock.calls[0][0]
    expect(args.to).toEqual(['a@b.com'])
  })
})

describe('emailSender — success path', () => {
  it('marks sent with messageId on success', async () => {
    sendMailMock.mockResolvedValue({
      messageId: '<happy@plesk>',
      accepted: ['ok@x.com'],
      rejected: [],
    })

    await handler(buildEvent('e11', {
      template: 'registration_submitted_confirm',
      to: ['ok@x.com'],
      context: {
        submittedByUid: 'u1',
        registrationId: 'r4',
        teamId: 't1',
        playerName: 'Dora',
        status: 'pending_payment',
      },
    }))

    const ref = fakeDocRefs.get('pendingEmails/e11')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      messageId: '<happy@plesk>',
      error: null,
    }))
  })

  it('renders subject + html + text via the template module', async () => {
    sendMailMock.mockResolvedValue({
      messageId: '<m@x>',
      accepted: ['z@z.com'],
      rejected: [],
    })

    await handler(buildEvent('e12', {
      template: 'registration_submitted_confirm',
      to: ['z@z.com'],
      context: {
        submittedByUid: 'u1',
        registrationId: 'r5',
        teamId: 't1',
        playerName: 'Eva',
        status: 'pending_decision',
      },
    }))

    const args = sendMailMock.mock.calls[0][0]
    expect(args.subject).toContain('Eva')
    expect(args.html).toContain('Eva')
    expect(args.html).toContain('<!DOCTYPE')
    expect(args.text).toContain('Eva')
    expect(args.text).not.toContain('<')
  })
})

describe('emailSender — failure path', () => {
  it('marks failed when sendMail throws', async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    }))

    await handler(buildEvent('e13', {
      template: 'registration_submitted_confirm',
      to: ['a@b.com'],
      context: {
        submittedByUid: 'u1',
        registrationId: 'r6',
        teamId: 't1',
        playerName: 'Hugo',
        status: 'pending_payment',
      },
    }))

    const ref = fakeDocRefs.get('pendingEmails/e13')
    expect(ref?.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('ECONNREFUSED'),
    }))
  })
})
