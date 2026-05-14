# Registrations — Phasage d'implémentation

> Découpage A→F livraison, état actuel, critères de done par phase, checklist PR Phase C.
> Pour le détail du wizard livré en Phase C : voir `docs/prompt-phase-c-wizard.md` (brief séparé) et [`design-to-vue-register.md`](../design-to-vue-register.md).

## État d'avancement (2026-05-14)

| Phase | Status |
|---|---|
| Phase A — Schéma + rules + types | ✅ Livrée |
| Phase B — Scaffolding + auth + E1–E4 (Landing / SignIn / Profile / Home) | ✅ Livrée |
| **Phase C — Wizard E5–E14** | ✅ **DONE 2026-05-14** |
| **Phase D — Workflow coach côté `apps/web`** | 🟡 **En cours 2026-05-14** (refus motivé + binding member/user livrés) |
| Phase E — Licences post-inscription (E15) | 🔜 Pas commencée |
| Phase F — Maturité (cron trial, becomeOwner, vendor mail) | 🔜 Pas commencée |

## Phase A — Foundations ✅ Livrée

1. Spec produit (ce doc + sous-briefs) + brief design `docs/design-brief-register.md`.
2. Types `Registration*`, `RefusalLog`, extensions `Team`/`Member`/`User` dans `packages/shared-types`.
3. `firestore.rules` + `firestore.indexes.json` (indices `(teamId, status)` et `(submittedByUid, createdAt desc)` sur `/registrations`).
4. `docs/firebase.md` : section `/registrations` + sub `/teams/{id}/refusalLogs` + extensions.
5. `storage.rules` posées (registrations/licenseRequests).
6. Callables `matchExistingMember`, `submitRegistration`, `cancelRegistration`, `refuseRegistration` déployées.

## Phase B — App scaffolding ✅ Livrée

7. `apps/courtbase-register` setup : Vite + Vue 3 + PrimeVue + Pinia + router.
8. Auth complète : email-password + Google + Apple + reset password + ProfileSetup.
9. Router 4 routes + guard 3 niveaux (public / auth-only / profile-required).
10. Bundle design claude.design importé + atoms portés dans `style.css`.
11. **Vues E1–E4 livrées au pixel** : Landing, SignIn, ProfileSetup, Home.
12. Doc de conversion `docs/design-to-vue-register.md`.

## Phase C — Wizard end-to-end ✅ DONE 2026-05-14

### Livrables Phase C

**9 vues wizard** (sous `apps/courtbase-register/src/views/register/`) :
- `Step1Whoami.vue` (E5) — "Pour qui ?" + RelationshipPicker.
- `Step2Identity.vue` (E6) — Identité + AVS + debounce `matchExistingMember`.
- `Step3TeamPicker.vue` (E8) — TeamPicker avec `listEligibleTeams(birthDate)` + variantes loading/empty.
- `Step4OpenHandbook.vue` (E9) — branche `team.registrationStatus === 'open'`.
- `Step4ConditionalConditions.vue` (E10) — branche `'conditional'`.
- `Step5Contact.vue` (E11) — Contact joueur + toggle "déjà licencié".
- `Step6TransferLetter.vue` (E12) — Upload lettre de sortie (sauté si `!previouslyLicensed`).
- `Step7LicenseInfo.vue` (E13) — Info licence (statique) + CTA submit.
- `Step8Confirmation.vue` (E14) — Récap + redirect Home.

**Shell partagé** :
- `WizardLayout.vue` — m-app + header + sticky bottom bar + slot.
- `components/wizard/Stepper.vue` — 9 dots done/current + label "ÉTAPE N / 9".

**4 composants partagés** (sous `components/wizard/`) :
- `TeamCard.vue` — 3 variantes pill (`pill-emerald` / `pill-amber` / `pill-slate`).
- `RelationshipPicker.vue` — grid radio-cards parent/tuteur/sibling/caritas/other.
- `MatchFoundDialog.vue` (E7) — bottom-sheet pour confirmer un match member.
- `DocumentUploadTile.vue` — 4 états empty/uploading/uploaded/refused.

**Plomberie** :
- Routes `/register/step-{1..8}` + meta.wizardStep + guard `useWizardGuard.ts`.
- Persistance sessionStorage (draft auto-enregistré entre refresh).
- Suppression drafts via `cancelRegistration` callable + UI Home.
- Bouton "Nouvelle inscription" actif sur Home, "Reprendre" actif sur les cards `draft`.

### Critères de done Phase C (validés)

- [x] Un user peut compléter une inscription bout-en-bout (auth → profil → wizard 9 étapes → confirmation).
- [x] Un draft est repris correctement depuis Home (bouton "Reprendre").
- [x] `npm run type-check -w @club-app/courtbase-register` passe.
- [x] Test manuel : un draft created, abandoned, et resumed donne le même état.
- [x] `Home.vue` rend correctement la registration soumise dans la liste.

### Leçons Phase C (intégrées dans les autres briefs)

1. **Callables v2 nécessitent binding IAM manuel** post-deploy (`allUsers/roles/run.invoker`). Sans ça, callable plante en `"internal"`. Voir [`functions.md`](./functions.md#51-binding-iam-cloud-run-allusersrolesruninvoker) pour la commande gcloud. Lié à [[deploy-functions-v2-invoker-binding]].
2. **Préférer single-field index + tri JS** sur petits volumes (< 100 docs) — éviter les index composites Firestore quand possible. Voir [`functions.md`](./functions.md#54-préférer-single-field--tri-js-sur-petits-volumes).
3. **OAuth race condition** à gérer dans le store auth via un flag `resolvingProfile` — sinon le guard 3 niveaux peut router prématurément vers `/profile` alors que le `/users/{uid}` existe déjà et arrive juste en async.
4. **`registrationStatus` absent sur teams legacy** : le repo traite l'absence comme `'closed'`. À fix côté admin UI en Phase D. Voir [`schema.md`](./schema.md#3-extensions-sur-teamsteamid).
5. **`email` interdit dans `upsertUserProfile` update** : la rule `/users/{uid}` n'autorise pas `email` dans `affectedKeys`. L'email Auth est source de vérité. Voir [`schema.md`](./schema.md#5-extensions-sur-usersuid).
6. **Indexes single-field DESC vont dans `fieldOverrides`**, pas dans `indexes`. Cas concret : `refusalLogs.refusedAt` DESC. Voir [`schema.md`](./schema.md#8-indexes-firestore).
7. **`birthDate` en ISO `YYYY-MM-DD` (string)** côté client → Timestamp côté serveur. Conversion à faire avant l'appel `submitRegistration`. Voir [`functions.md`](./functions.md#22-submitregistration).
8. **`firebase functions:log` cassé** sur ce projet — utiliser `gcloud logging read` directement. Voir [`functions.md`](./functions.md#52-diagnostic-des-erreurs-callables).

### Checklist PR Phase C (référence historique)

- [x] 9 vues + 1 dialog livrées.
- [x] `WizardLayout.vue` + `Stepper.vue` + 4 composants partagés livrés.
- [x] Routes + guard `useWizardGuard` + meta `wizardStep`.
- [x] Bouton "Nouvelle inscription" actif sur Home.
- [x] "Reprendre" actif sur les cards `draft`.
- [x] `npm run type-check -w @club-app/courtbase-register` passe.
- [x] Test manuel bout-en-bout : créer compte → profil → wizard → confirmation → Home affiche la registration soumise.
- [x] `firestore.rules` : writes drafts passent (re-déployées — cf. mémoire `deploy_firestore_rules_required`).

## Phase D — Workflow coach (app web) 🟡 En cours

### Livrables Phase D (2026-05-14 — première tranche)

**Vue Inscriptions (`apps/web/src/views/Inscriptions.vue`)** — route `/registrations`, allowed roles `['admin', 'coach']`. Affiche toutes les registrations **non-draft** avec :
- Chips status (`active` / `submitted` / `trial` / `done` / `terminal` / `all`) + counts live.
- Select de filtre équipe (alimenté dynamiquement par les teams présentes dans la liste — libellé "Toutes les équipes" si admin, "Mes équipes" si coach).
- Recherche libre (nom joueur, ancien club, motif de refus).
- Table avec avatar joueur, équipe, statut (Pill coloré), date soumission relative, action(s) inline.
- Drawer détail in-page (statut + journal d'actions + identité joueur + contexte soumission + historique sportif).

**Scope auto par rôle** dans `useRegistrationsStore.load()` :
- admin / rootAdmin → `listAllNonDraftRegistrations()` (toute la collection, cap 200).
- coach → `listRegistrationsForTeams(auth.userDoc.teamIds)` — une query Firestore par teamId, merge + tri JS (évite la limite `in` à 10 pour les coachs multi-équipes).

**Action livrée — refus motivé** :
- Dialog `<Dialog>` avec textarea motif obligatoire (validé serveur — sinon `invalid-argument`).
- Wrapper TS dans `services/cloudFunctions.ts` → callable `refuseRegistration` (déjà déployée Phase A.6).
- Re-load auto après succès pour récupérer le nouveau status + `refusalReason`.
- Bandeau d'info dans le dialog signalant qu'un mail partira à l'auteur + qu'un auto-rerouting peut suivre (trigger `onRegistrationStatusChanged`).

**Wrappers callables ajoutés** dans `services/cloudFunctions.ts` :
- `refuseRegistration({ registrationId, reason })`.
- `cancelRegistration({ registrationId, note? })` — pour symétrie ; côté admin/coach plante en `permission-denied` sauf si le caller est le `submittedByUid`. À remplacer par une `adminCancelRegistration` séparée plus tard.

**Repo registrations (`apps/web/src/repositories/registrations.repo.ts`)** :
- Constantes `NON_DRAFT_STATUSES` (9 statuts) + `ACTIVE_STATUSES` (6 non-terminaux).
- Type enrichi `RegistrationRow extends Registration` avec `team`, `playerFullName`, `playerAge` (résolus à la lecture, batch lookup `/teams`).
- Helpers `registrationStatusLabel(status)` / `registrationStatusVariant(status)` / `isRefusable(status)` réutilisables dans la vue.

**Sidebar + routing** : entrée "Inscriptions" dans la section Operations (icône `ClipboardList`), route `meta.allowedRoles = ADMIN_COACH`.

### Livrables Phase D — Binding admin member ↔ compte d'inscription (2026-05-14)

Quand un parent s'inscrit via `apps/courtbase-register`, un `/users/{uid}` est créé avec rôle `parent` et lié au membre via `member.guardianUserIds[]`. L'app web `apps/web` exploite ce lien sur la **page détail membre** :

**Enrichissement `GuardianRef`** (`apps/web/src/repositories/members.repo.ts`) :
- Ajout de `phone: string | null`, `address: UserAddress | null`, `profileCompletedAt: Timestamp | null` (champs posés via l'app register).
- `readGuardians()` résout ces champs depuis `/users/{uid}` ; dégradation gracieuse (tous `null`) sur `permission-denied` ou doc absent.

**Liaison admin `/members.linkedUserId` ↔ `/users.memberId`** :
- Nouvelle fonction `setLinkedUser(memberId, uid | null)` dans `members.repo.ts` — `writeBatch` atomique bidirectionnel avec nettoyage des deux orphelins potentiels (ancien `linkedUserId` du member + ancien `memberId` du user choisi).
- Action store `setLinkedUser` dans `useMembersStore` (pattern try/catch enrichi `FirebaseError`).
- Nouveau composant `apps/web/src/components/member-detail/ManageLinkedUserDialog.vue` (calqué sur `ManageGuardiansDialog.vue`) : recherche user par email via `searchUsersByEmail`, AutoComplete PrimeVue, validations (`alreadyLinked` / `isGuardian`), bouton primaire "Lier" / "Remplacer", bouton secondaire "Délier" avec confirmation 2 clics.
- `ProfileTab.vue` — bloc Tuteurs enrichi avec téléphone + adresse formatée + Pill "Profil complété" / "Profil incomplet" ; card "Compte Firebase Auth" passe de read-only à actionnable (bouton "Lier un compte" si vide, "Modifier" sinon).

**Pas de modif rules nécessaire** : `/members.linkedUserId` est admin-write (rule existante `allow write: if isRootAdmin() || isAdmin()`), et `/users.memberId` reste admin-only (la rule self-update whitelist explicitement `displayName/photoURL/phone/address/profileCompletedAt` et exclut `memberId`).

### Restant Phase D

24. Callables manquantes côté `functions/src/registrations/` :
   - `acceptRegistration` — transition `conditional_pending_review` → `conditional_pending_trial` (cas branche conditional).
   - `markTrialInProgress` — transition vers `trial_in_progress` (démarre compteur 14j).
   - `confirmRegistration` — transition vers `confirmed_pending_dues` (déclenche `createDuesForRegistration`).
   - `adminCancelRegistration` — annulation par admin/coach d'une registration tierce.
25. Branchement de ces callables dans `useRegistrationsStore` (handlers `accept` / `markTrial` / `confirm` déjà esquissés côté vue — voir todos `Inscriptions.vue` lignes ~5 / ~11 / ~27).
26. Auto-rerouting via Function `onRegistrationRefused` (trigger Firestore, pas une callable).
27. **Fix legacy** : admin UI pour poser `registrationStatus` sur les teams pré-existantes au chantier (cf. leçon Phase C §4).

**Critère de done Phase D (final)** :
- Un coach voit la liste de ses inscriptions et peut accept/refuse/mark-trial/confirm depuis l'app web.
- L'auto-rerouting fonctionne quand une équipe `open` existe dans la catégorie.
- L'admin a une vue globale "Toutes inscriptions" avec filtres status/team/age (✅ livré).
- L'admin peut lier un member existant à un compte d'inscription via la page détail membre (✅ livré).
- L'admin voit les données complètes (phone + adresse) des tuteurs sur la page détail membre (✅ livré).

## Phase E — Licences (post-inscription) 🔜

29. Page `LicenseDocs.vue` dans app register (E15) — `DocumentUploadTile` réutilisable depuis Phase C step 6.
30. Function `generateLicenseForm` (PDF) — peut commencer en stub HTML→PDF.
31. UI admin "Documents licence pending" + accept/refuse par doc.
32. Branchement avec `/licenses` (Phase 2 du chantier licences — dépendance).

**Critère de done Phase E** :
- Un user reçoit la notif licence après acceptation coach.
- Il peut uploader les 3 docs (pièce ID recto/verso + formulaire signé).
- L'admin peut accept/refuse chaque doc, et créer la `/licenses/{id}` à l'arrivée.

## Phase F — Maturité 🔜

33. Cron `onTrialExpired` + notifs.
34. Toggle `becomeOwnerOfMyMember` à la majorité — `BecomeMajorDialog.vue` (E16).
35. Indicateur "coach trop refusant" (vue admin).
36. Vendor email réel (commun avec `pendingEmails`).

**Critère de done Phase F** :
- Le cron trial tourne et envoie ses notifs.
- Un pupille majeur peut prendre la main sur son membre.
- Les emails partent réellement via un vendor (SendGrid/Resend).

Chaque phase = une PR distincte. Phases A–C ont été merged sans Phase D côté coach — il faut valider manuellement via Firestore console le temps de finir D.
