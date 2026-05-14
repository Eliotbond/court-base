# Chantier — Page Member detail (`/members/:id`)

> Brief du chantier d'implémentation de la page détail membre + backend associé.
> Statut : **livré, non commité** (cf. memory `feedback_no_auto_actions`).
> Stack : Vue 3 + PrimeVue + Pinia + Firebase modular SDK. TS strict.

## Objectif

Remplacer le placeholder `/members/:id` par une fiche membre complète avec
**5 onglets** (Profil / Cotisations / Présences / Officiel / Demandes), un
header riche (avatar, rôles, status pills, contact, teams cliquables) et les
actions admin (éditer profil, éditer contact, archiver / réactiver).

L'implémentation couvre l'intégralité du stack : repositories Firestore →
composables → vue, en respectant l'architecture en couches.

## Architecture livrée

```
views/MemberDetail.vue
  └─ stores/memberDetail.ts  (core : member + mutations)
       └─ repositories/members.repo.ts  (getMemberDetail + writes)
  └─ components/member-detail/
       ├─ ProfileTab.vue        ← identité / contact / rôles / compte Auth
       ├─ DuesTab.vue           → composables/useMemberDues.ts        → repositories/dues.repo.ts
       ├─ AttendanceTab.vue     → composables/useMemberAttendance.ts  → repositories/attendance.repo.ts
       ├─ OfficialTab.vue       → composables/useMemberOfficialAssignments.ts → repositories/officialAssignments.repo.ts
       └─ RequestsTab.vue       → composables/useMemberRequests.ts
                                    ├─ repositories/licenseRequests.repo.ts
                                    └─ repositories/paymentExceptions.repo.ts
```

**Pattern** : chaque tab est autonome (composable + repo dédiés). Seules les
données core du membre (identité, contact, teams, linkedUser) transitent par
le store Pinia. Tradeoff : pas de cache cross-tab, mais paths complètement
disjoints → parallélisable et maintenable.

## Découpage des paths (pour la parallélisation)

Le travail a été éclaté entre **5 contributeurs** (1 foreground + 4 agents
Opus 4.7 en background) sur des paths strictement disjoints :

| Contributeur | Périmètre |
|---|---|
| Foreground (Opus 4.7) | members.repo.ts extension · memberDetail.ts · MemberDetail.vue · ProfileTab.vue · router · indexes Firestore |
| Agent A | dues.repo.ts (extension) · useMemberDues.ts · DuesTab.vue |
| Agent B | attendance.repo.ts (extension) · useMemberAttendance.ts · AttendanceTab.vue |
| Agent C | officialAssignments.repo.ts · useMemberOfficialAssignments.ts · OfficialTab.vue |
| Agent D | licenseRequests.repo.ts · paymentExceptions.repo.ts · useMemberRequests.ts · RequestsTab.vue |

Zéro collision : aucun fichier touché par deux contributeurs. Confirme le
pattern documenté dans `feedback_parallel_opus_agents.md`.

## Décisions importantes

### 1. `MemberDetailRow` au-dessus de `MemberRow`, pas remplacement

`Members.vue` (liste) consomme `MemberRow` (member + contact + teamLabels +
lastLoginAt). La page détail a besoin de plus (teams avec rôle coach/player,
linkedUser). On a donc créé `MemberDetailRow extends MemberRow` avec
`teams: MemberTeamRef[]` et `linkedUser: User | null`. **Pourquoi** : ne pas
casser la liste qui marche déjà, et garder une frontière typée claire entre
liste (compact) et détail (riche).

### 2. Pas de `clubMemberships[]` — un user appartient à un seul projet

Le doc `/users/{linkedUserId}` est chargé en jointure dans `getMemberDetail`
avec dégradation `permission-denied` → `null`. Cohérent avec le modèle
multi-tenant (`docs/main.md` : *un projet Firebase = un club*). Le tab Profile
affiche les rôles Auth séparément des rôles club (`/members.roles`) — c'est
important car un membre peut avoir `roles: ['player']` côté `/members` mais
`['coach']` côté `/users` (cumul rôles club / scope app, cf. memory
`project_roles_additifs.md`).

### 3. Architecture verticale par tab (repo + composable + view)

Chaque tab a son propre repo + composable au lieu de tout entasser dans le
store. **Pourquoi** : (1) parallélisable, (2) lazy-loadable, (3) le scope d'un
tab est sectionnel à la page — pas besoin de partager l'état entre composants.
Le store Pinia `memberDetail` reste léger (juste le core member).

### 4. Tabs visibles conditionnellement selon les rôles

- `Cotisations` visible si `isPlayer` (autres rôles n'ont pas de dues)
- `Présences` visible si `isPlayer || isCoach`
- `Officiel` visible si `officialLevel !== null`
- `Profil` et `Demandes` toujours visibles

Si l'admin retire un rôle pendant la session, un `watch` rebascule sur Profil.
**Pourquoi** : éviter d'afficher des sections vides pour les rôles qui ne les
utilisent pas (un official-only n'a pas de cotisations).

### 5. Dégradation gracieuse `permission-denied` → état vide, pas crash

Tous les repos suivent le pattern de `readContact` dans `members.repo.ts` :
`FirebaseError` avec `code === 'permission-denied'` → return `[]` ou `null`.
**Pourquoi** : la page doit rester affichable selon le rôle. Un coach qui
ouvre la fiche d'un joueur d'une autre équipe verra le profil mais pas les
dues (rules : `coach && teamId in userDoc().teamIds`). Sans cette
dégradation, la page entière crasherait.

### 6. CollectionGroup queries + indexes manquants → bannière, pas crash

Pour `attendance` et `officialAssignments` (sub-collections de `/bookings`),
on utilise `collectionGroup` avec filtre `where('memberId', '==', id)`.
Les indexes composites COLLECTION_GROUP étaient absents → on les a ajoutés
dans `firestore.indexes.json` :

```json
{ "collectionGroup": "attendance",          "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "memberId", "order": "ASCENDING" },
             { "fieldPath": "recordedAt", "order": "DESCENDING" }] },
{ "collectionGroup": "officialAssignments", "queryScope": "COLLECTION_GROUP",
  "fields": [{ "fieldPath": "memberId", "order": "ASCENDING" },
             { "fieldPath": "assignedAt", "order": "DESCENDING" }] }
```

Tant que ces indexes ne sont **pas déployés**, le repo capture
`FirebaseError.code === 'failed-precondition'`, log un `console.warn` et
retourne `[]`. Le composable expose un flag `missingIndex` que le tab utilise
pour afficher une bannière info amber au lieu d'une erreur rouge. **Pourquoi** :
la page reste utilisable en mode dégradé pendant la fenêtre de déploiement.

### 7. Indicateur de rentabilité officiel : proxy "12 derniers mois", pas "saison active"

`docs/main.md` définit la rentabilité par saison (`thresholdGreen=6 matches`).
Mais la "saison active" nécessite un lookup `/seasons` que le tab Officiel
n'a pas envie de faire (sprawl). **Décision** : utiliser
`bookingDate > Date.now() - 365 jours` comme proxy. Documenté en commentaire
dans `useMemberOfficialAssignments.ts`. **Migration future triviale** :
remplacer le filtre `cutoff` par `row.seasonId === activeSeasonId` quand
`getActiveSeasonId()` sera exposé.

### 8. `markDuePaid` : on n'a pas modifié la signature existante

Le brief proposait `{ paidAmount, paymentMethod, paidAt?, notes?, recordedBy }`,
mais `stores/dues.ts` consommait déjà `{ paidAt, amount, method, note? }` avec
`recordedBy` résolu via `getAuth().currentUser` côté repo. **Décision** : garder
l'existant pour ne pas casser l'autre vue. Effet utilisateur identique.

### 9. License / Payment exception : pas de double-write côté client

Les writes côté client se limitent à `updateDoc` sur le doc request avec
`{ status: 'approved' | 'rejected', reviewedAt, reviewedBy, adminComment }`.
**Pourquoi** : les Functions `applyLicenseRequest` et `applyPaymentException`
trigger sur l'update et propagent les effets (`member.licensed = true`,
mise à jour `/dues`, etc.). Single source of truth : l'effet métier est
serveur, l'UI ne s'occupe que de la décision admin.

### 10. Type local `AttendanceEntry` au lieu d'un type partagé

Le schéma `/bookings/{bookingId}/attendance/{id}` est documenté dans
`docs/firebase.md` mais pas encore dans `packages/shared-types`. Le tab
Présences définit un type local enrichi (avec jointure booking + team).
**Pourquoi** : éviter de bloquer le chantier sur une PR types ; à migrer
dans `shared-types/src/attendance.ts` quand le besoin se présente (autre
chantier).

### 11. Dialog "Définir niveau officiel" → écrit dans member.officialLevel

Côté OfficialTab, si `officialLevel === null` et admin, un dialog L1/L2 ouvre
et appelle `useMemberDetailStore().applyProfilePatch({ officialLevel })`.
Le store reload après l'update → `isOfficial` devient `true` → un `watch`
relance `load()` du tab. **Pourquoi cohérent** : la mutation est UNE
responsabilité du store member (level fait partie du doc `/members/{id}`),
pas une responsabilité du repo officialAssignments.

## Permissions

| Action | Rôle requis |
|---|---|
| Lire la page (route guard) | admin OR coach |
| Voir contact (email/phone) | admin OR coach OR self (cf. rules `/members/{id}/private/contact`) |
| Modifier profil (firstName/lastName/licenseNumber/active) | admin |
| Modifier contact | admin OR self |
| Archiver / réactiver | admin |
| Marquer cotisation payée | admin |
| Approve/reject license request | admin |
| Approve/reject payment exception | admin |
| Définir niveau officiel | admin |

Le flag `canEdit` est passé en prop à chaque tab (`isAdmin || rootAdmin`).
Les boutons d'édition sont masqués sinon. Note : même si l'UI laisse passer,
les rules Firestore sont la vraie barrière.

## Indexes Firestore à déployer

```bash
firebase deploy --only firestore:indexes
```

Sans ce déploiement :
- Tab Présences → bannière amber "Index manquant"
- Tab Officiel → bannière amber "Index manquant"
- Profile / Cotisations / Demandes → fonctionnent (indexes déjà présents).

## Reste à faire (hors scope ce chantier)

- **Edit étendu du profil** : rôles club (player/coach/official/comite/referee),
  flag licensed, link/unlink Auth — pour MVP, seuls firstName/lastName/license
  number sont éditables via le dialog.
- **`lastLoginAt`** : nécessite une callable Admin SDK (Firebase Auth
  `lastSignInTime` non exposé côté client). TODO actuellement à `null`.
- **Indexes via PR séparée** : déjà ajoutés au JSON mais le déploiement est
  manuel.
- **Migration `AttendanceEntry` → `shared-types`** : à faire dans le chantier
  Attendance write-side.
- **Saison active dans `OfficialTab`** : remplacer le proxy 12-mois par
  `seasonId === activeSeasonId` quand un `getActiveSeasonId()` sera exposé.

## Validation

- `npm run typecheck -w apps/web` → **0 erreur**
- `npm run lint -w apps/web` → **0 erreur** (3 warnings préexistants sur
  `Avatar.vue` hors scope)

## Fichiers livrés

**Modifiés :**
- `apps/web/src/repositories/members.repo.ts` (+195 lignes)
- `apps/web/src/repositories/dues.repo.ts` (extension)
- `apps/web/src/repositories/attendance.repo.ts` (extension)
- `apps/web/src/repositories/officials.repo.ts` (fix lint mineur, hors scope)
- `apps/web/src/router/index.ts` (1 ligne)
- `firestore.indexes.json` (+2 indexes COLLECTION_GROUP)

**Créés :**
- `apps/web/src/views/MemberDetail.vue`
- `apps/web/src/stores/memberDetail.ts`
- `apps/web/src/components/member-detail/ProfileTab.vue`
- `apps/web/src/components/member-detail/DuesTab.vue`
- `apps/web/src/components/member-detail/AttendanceTab.vue`
- `apps/web/src/components/member-detail/OfficialTab.vue`
- `apps/web/src/components/member-detail/RequestsTab.vue`
- `apps/web/src/composables/useMemberDues.ts`
- `apps/web/src/composables/useMemberAttendance.ts`
- `apps/web/src/composables/useMemberOfficialAssignments.ts`
- `apps/web/src/composables/useMemberRequests.ts`
- `apps/web/src/repositories/officialAssignments.repo.ts`
- `apps/web/src/repositories/licenseRequests.repo.ts`
- `apps/web/src/repositories/paymentExceptions.repo.ts`
