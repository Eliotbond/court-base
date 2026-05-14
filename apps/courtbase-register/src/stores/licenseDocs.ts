import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LicenseRequest, Member } from '@club-app/shared-types'
import {
  getLicenseRequestById,
  listLicenseRequestsForMembers,
} from '@/repositories/licenseRequests.repo'
import { listAccessibleMembers } from '@/repositories/members.repo'
import {
  uploadLicenseDocument,
  type UploadResult,
} from '@/repositories/storage.ts'

/**
 * Store LicenseDocs — alimente l'écran E15 (Documents licence).
 *
 * Surface :
 *  - `myMembers` : self + dépendants → résolus via `listAccessibleMembers`.
 *  - `requestsByMember` : `memberId → LicenseRequest[]` (tri `createdAt desc`).
 *  - `currentRequest` : le LR ouvert dans le détail.
 *  - `upload(...)` : upload Storage + (TODO Phase E) callable `uploadLicenseDocument`
 *    pour notifier l'admin que le doc est prêt à review.
 *
 * Tant que la callable serveur n'est pas wirée (Phase E), l'upload reste
 * "fire and forget" — le fichier est dans Storage, mais aucune entrée
 * Firestore n'est créée. L'admin verra le fichier directement via le
 * console Storage en attendant.
 */
export const useLicenseDocsStore = defineStore('licenseDocs', () => {
  const myMembers = ref<Member[]>([])
  const requestsByMember = ref<Map<string, LicenseRequest[]>>(new Map())
  const currentRequest = ref<LicenseRequest | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const uploadingKind = ref<string | null>(null)

  async function loadMyMembers(uid: string, linkedMemberId: string | null): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const list = await listAccessibleMembers(uid, linkedMemberId)
      myMembers.value = list
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadRequestsForMyMembers(): Promise<void> {
    const ids = myMembers.value.map((m) => m.id)
    if (ids.length === 0) {
      requestsByMember.value = new Map()
      return
    }
    loading.value = true
    error.value = null
    try {
      const flat = await listLicenseRequestsForMembers(ids)
      const next = new Map<string, LicenseRequest[]>()
      for (const r of flat) {
        const existing = next.get(r.memberId) ?? []
        existing.push(r)
        next.set(r.memberId, existing)
      }
      requestsByMember.value = next
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadRequest(requestId: string): Promise<LicenseRequest | null> {
    const r = await getLicenseRequestById(requestId)
    currentRequest.value = r
    return r
  }

  async function upload(args: {
    uid: string
    requestId: string
    kind: 'id_front' | 'id_back' | 'license_form_signed' | 'transfer_letter'
    file: File
  }): Promise<UploadResult> {
    uploadingKind.value = args.kind
    try {
      return await uploadLicenseDocument(args)
    } finally {
      uploadingKind.value = null
    }
  }

  const hasAnyRequest = computed(() =>
    Array.from(requestsByMember.value.values()).some((arr) => arr.length > 0),
  )

  return {
    myMembers,
    requestsByMember,
    currentRequest,
    loading,
    error,
    uploadingKind,
    hasAnyRequest,
    loadMyMembers,
    loadRequestsForMyMembers,
    loadRequest,
    upload,
  }
})
