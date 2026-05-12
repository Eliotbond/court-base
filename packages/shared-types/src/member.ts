import type { Timestamp } from './index'

/**
 * Document `/members/{memberId}` — fiche membre côté club.
 * Voir docs/firebase.md (section /members/{memberId}).
 *
 * **Pas de `email`/`phone` ici** : ces champs vivent dans la subcollection
 * `/members/{memberId}/private/contact` (voir `MemberContactData`), gated
 * pour exclure les `official`-only de la lecture.
 */
export type DuesStatus =
  | 'ok'
  | 'pending_grace'
  | 'due'
  | 'overdue'
  | 'excluded'
  | 'excepted'
  | 'n/a'

export interface MemberData {
  firstName: string
  lastName: string
  /** refs vers /roles */
  roles: string[]
  /** uid Auth si le membre a un compte */
  linkedUserId: string | null
  licenseNumber: string
  /** 1, 2 ; null si pas official. Manuel admin. */
  officialLevel: number | null
  licensed: boolean
  duesStatus: DuesStatus
  duesStatusUpdatedAt: Timestamp
  active: boolean
}

export type Member = MemberData & { id: string }

/**
 * Document `/members/{memberId}/private/contact` (ID fixe `contact`).
 * Lecture : admin, coach, et le membre lui-même.
 * Écriture : admin et le membre lui-même.
 * Les `official`-only ne lisent PAS ce doc.
 */
export interface MemberContactData {
  email: string
  phone: string
}

export type MemberContact = MemberContactData & { id: string }
