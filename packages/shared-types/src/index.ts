// Types partagés — alignés avec docs/firebase.md
// Toute modif ici DOIT être reflétée dans docs/firebase.md.

export * from './config'
export * from './user'
export * from './member'
export * from './role'
export * from './invitation'
export * from './category'
export * from './tag'
export * from './cotisationType'
export * from './team'
export * from './venue'
export * from './season'
export * from './booking'
export * from './bookingSeries'
export * from './matchType'
export * from './matchRequest'
export * from './match'
export * from './notification'
export * from './cotisation'
export * from './license'
export * from './registration'
export * from './meta'

/**
 * Représentation neutre d'un Firestore Timestamp,
 * pour éviter de dépendre du SDK Firebase dans ce package.
 */
export interface Timestamp {
  seconds: number
  nanoseconds: number
}

/** GeoPoint neutre */
export interface GeoPoint {
  latitude: number
  longitude: number
}
