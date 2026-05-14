# Wizard d'inscription — brief permanent

> Référence durable sur l'architecture du wizard parents/joueurs de l'app `apps/courtbase-register`.
>
> Périmètre : 8 étapes (9 vues à cause des deux variantes de step-4), composants partagés, atoms CSS spécifiques, playbook pour ajouter/modifier une étape.
>
> Source d'origine : ce brief absorbe l'ancien `docs/prompt-phase-c-wizard.md` (prompt ad-hoc utilisé pour dispatcher les 9 agents Phase C livrée le 2026-05-14).
>
> Sources complémentaires : `docs/registrations/overview.md`, `schema.md`, `functions.md`, `lifecycle.md` (autres briefs du chantier inscriptions), `docs/design-to-vue-register.md` (atoms CSS et conversion claude.design → Vue), `apps/courtbase-register/CLAUDE.md` (règles app).

## 1. Vue d'ensemble

Le wizard a 8 étapes logiques mais **9 routes** Vue (les variantes step-4-open / step-4-conditional vivent sur deux routes distinctes pour simplifier le rendu et l'historique). Toutes les routes sont sous `/register/`.

| Étape | Route Vue | Fichier `.vue` | Action store principale | Écran prototype |
|---|---|---|---|---|
| 1 | `/register/step-1` | `views/register/Step1Whoami.vue` | `startDraft()` à la transition vers step-2 | `tpl-e5` |
| 2 | `/register/step-2` | `views/register/Step2Identity.vue` | `patchDraft({ player })` + `findMatches()` au blur AVS | `tpl-e6` (+ `tpl-e7` modal match) |
| 3 | `/register/step-3` | `views/register/Step3TeamPicker.vue` | `useTeamsStore().loadEligible(birthDate)` au mount ; `patchDraft({ teamId })` au choix | `tpl-e8` (+ `tpl-e8↻` skeleton, `tpl-e8⌀` empty) |
| 4 (open) | `/register/step-4-open` | `views/register/Step4OpenHandbook.vue` | lit `currentDraft.teamId` puis `getPublicTeamById` | `tpl-e9` |
| 4 (conditional) | `/register/step-4-conditional` | `views/register/Step4ConditionalConditions.vue` | idem ; pas de soumission ici | `tpl-e10` |
| 5 | `/register/step-5` | `views/register/Step5Contact.vue` | `patchDraft({ player.phone, previouslyLicensed, previousClubName, previousClubAbroad })` | `tpl-e11` |
| 6 | `/register/step-6` | `views/register/Step6TransferLetter.vue` | `uploadFile(...)` puis `patchDraft({ transferLetterStoragePath })` ; redirige step-7 si `!previouslyLicensed` | `tpl-e12` |
| 7 | `/register/step-7` | `views/register/Step7LicenseInfo.vue` | `useRegistrationsStore().submit(...)` puis `router.replace('/register/confirmation/:id')` | `tpl-e13` |
| 8 | `/register/confirmation/:registrationId` | `views/register/Step8Confirmation.vue` | `loadRegistration(route.params.registrationId)` | `tpl-e14` |

### État partagé du wizard

L'état brouillon vit dans **`useRegistrationsStore().currentDraft`** — un computed Pinia dérivé de `byId[currentDraftId]`. Cet état est persisté de deux façons :

- **Côté serveur** : à chaque transition `patchDraft()` écrit un doc `/registrations/{id}` avec `status === 'draft'`.
- **Côté client** : `currentDraftId` est persisté en `sessionStorage` sous la clé `'court-base.register.currentDraftId'` pour survivre à un refresh page (mais pas à une fermeture d'onglet — c'est volontaire).

Au mount de chaque vue de wizard, si `currentDraft === null`, redirige vers `/register/step-1` (état perdu, on recommence).

## 2. Composants partagés (`src/components/wizard/`)

Ces composants sont livrés en Phase C et stables. Réutilise-les ; ne duplique pas.

| Composant | Props | Events | Notes |
|---|---|---|---|
| `WizardLayout` | `current, title, backTo?, closeMode?, total=8` | (slots `default`, `footer`) | shell mobile : `.m-app` + header (back arrow + label + "brouillon auto-enregistré") + `<Stepper>` + zone de contenu + `.m-bottom` sticky footer via slot |
| `Stepper` | `current, title, total=8` | — | rend `.stepper` avec 8 dots (`.done` pour `i < current`, `.current` pour `i === current`, `.pending` sinon) + label `{{ title }}` + meta "ÉTAPE N/8" |
| `RelationshipPicker` | `relationship, relationshipOther` | `update:relationship`, `update:relationshipOther` | double v-model ; grid 2 colonnes de `.radio-card` (Parent / Tuteur / Frère-Sœur / Caritas / Autre + input texte si Autre) |
| `TeamCard` | `team: PublicTeam` | `pick(team)` | 3 variantes selon `team.registrationStatus` (open émeraude / conditional ambre / closed désactivé) ; affiche nom, catégorie, pill, schedule, coach |
| `MatchFoundDialog` | `matches: MemberMatch[], visible: boolean` | `confirm(memberId)`, `reject` | bottom-sheet rendu via `.modal-overlay` + `.modal-sheet` (PAS de PrimeVue Drawer) |
| `DocumentUploadTile` | `label, helper?, file: UploadState, accept?` | `pick(file)`, `remove`, `retry` | 4 états export `UploadState` : `empty` / `uploading` / `uploaded` / `refused` ; ne fait pas l'upload lui-même, émet juste `pick(file)` au parent |

Tous ces composants sont en `<script setup lang="ts">` strict, sans `any`. Ils n'importent **jamais** le SDK Firebase — seul le store appelle les repos.

## 3. Atoms CSS — référence

La liste exhaustive des atoms vit dans `docs/design-to-vue-register.md` §3-4. Voici uniquement les atoms spécifiques au wizard, à vérifier dans `apps/courtbase-register/src/style.css` avant d'ajouter une étape :

- `.stepper`, `.stepper-dots`, `.step-dot[.done|.current|.pending]`, `.stepper-label` — barre de progression haut de page.
- `.choice-card`, `.choice-card.selected` — grosse carte de choix (étape 1).
- `.team-card`, `.team-card.disabled` — carte équipe (étape 3).
- `.doc-tile`, `.doc-tile.uploaded`, `.doc-tile.uploading`, `.doc-tile.refused` — tuile d'upload (étape 6).
- `.banner`, `.banner-info`, `.banner-warn`, `.banner-strong`, `.banner-soft`, `.banner-success` — bandeaux d'info.
- `.m-app`, `.m-header`, `.m-content`, `.m-bottom` — shell mobile rendu par `WizardLayout`.
- `.radio-card`, `.radio-card.selected` — utilisé par `RelationshipPicker`.
- `.modal-overlay`, `.modal-sheet`, `.modal-grabber` — utilisé par `MatchFoundDialog`.

Si un atome manque, l'ajouter dans `style.css` dans la même PR que la vue qui l'utilise (cf. `design-to-vue-register.md` §8).

## 4. Flow de chaque étape

### Step 1 — Whoami (`Step1Whoami.vue`)

- État local : `registrationFor: 'self' | 'dependent'`, plus `relationship` + `relationshipOther` si dépendant.
- Action store : `startDraft({ registrationFor, relationship, relationshipOther, player: { firstName: '', lastName: '', birthDate: <Timestamp epoch 0>, gender: null, avs: null, avsUnavailable: false, phone: null } })` au clic Continuer.
- Validation client : `registrationFor` obligatoire ; si `dependent` alors `relationship` obligatoire (et `relationshipOther` non-vide si `relationship === 'other'`).
- Cible suivante : `/register/step-2`.
- Précédent : disabled (étape 1).
- Gotcha : `birthDate` est initialisée à `Timestamp` epoch 0 (placeholder) parce que `startDraft` exige la forme complète du `player`. La vraie valeur est écrite à step-2.

### Step 2 — Identity (`Step2Identity.vue`)

- État local : `firstName`, `lastName`, `birthDate` (date picker), `gender`, `avs`, `avsUnavailable`.
- Validation client : AVS regex `/^756\.\d{4}\.\d{4}\.\d{2}$/` (skip si `avsUnavailable === true`). `.input.error` + `.helper-error` si invalide non-vide.
- Action store : au blur AVS valide (ou au Continuer), appelle `findMatches({ firstName, lastName, birthDate: 'YYYY-MM-DD', avs })`. Si `matches.length > 0` → ouvre `<MatchFoundDialog>`. Sur `@confirm(memberId)`, `patchDraft({ matchedMemberId: memberId })` puis step-3. Sur `@reject`, `clearMatches()` puis step-3.
- Cible suivante : `/register/step-3`.
- Gotcha : conversion `Timestamp` neutre côté client (cf. `design-to-vue-register.md` §10) — le type `Timestamp` de `@club-app/shared-types` est `{ seconds, nanoseconds }`, pas la classe Firebase. Le date picker doit lire et écrire via le helper `tsToDate` / `dateToTs`.

### Step 3 — Team Picker (`Step3TeamPicker.vue`)

- État local : aucun (la liste est dans `useTeamsStore().eligible`).
- Action store : au mount, `useTeamsStore().loadEligible(currentDraft.player.birthDate)`. Si pas de draft, redirige `/register/step-1`.
- États visuels : `loading` (skeleton cards × 2), `empty` (illustration SVG inline + 2 CTAs), liste de `<TeamCard>`.
- Banner info en haut si plus d'une équipe éligible.
- Cible suivante : `/register/step-4-open` si `team.registrationStatus === 'open'`, sinon `/register/step-4-conditional`.
- Gotcha : `useTeamsStore().loadEligible` trie en JS (pas via `orderBy` Firestore) — évite l'index composite (cf. `design-to-vue-register.md` §10).
- Pas de bouton Précédent en bas ici (retour via flèche du header `WizardLayout`).

### Step 4 — Open Handbook (`Step4OpenHandbook.vue`)

- Lit `currentDraft.teamId`, charge l'équipe via `useTeamsStore().loadById(teamId)`.
- **Redirect miroir** : si `team.registrationStatus !== 'open'`, redirige `/register/step-4-conditional`. Cette vue ne gère que les équipes ouvertes.
- Affiche pill émeraude "Équipe ouverte", titre "Bienvenue dans l'équipe {team.name}", card coach, markdown `team.openHandbook`, liste horaires.
- Cible suivante : `/register/step-5`. Bouton "Changer d'équipe" → `/register/step-3`.

### Step 5 — Conditional Conditions (`Step4ConditionalConditions.vue`)

- Variante miroir de step-4-open. Si `team.registrationStatus === 'open'`, redirige `/register/step-4-open`.
- Pill ambre, chips ambre pour `team.conditionalCriteria`, markdown `team.conditionalDescription`, banner warn "candidature examinée".
- Cible suivante : `/register/step-5`. **Le CTA "Soumettre ma candidature" ne soumet pas la registration** — il avance juste à step-5 (la soumission finale est à step-7).

### Step 5 — Contact (`Step5Contact.vue`)

- État local : téléphone joueur, `previouslyLicensed` (toggle), `previousClubName`, `previousClubAbroad`.
- Action store : `patchDraft({ player: { ...player, phone }, previouslyLicensed, previousClubName, previousClubAbroad })`.
- Helper "Si le joueur est mineur, vous pouvez laisser vide" sous l'input phone.
- Cible suivante : si `previouslyLicensed === true` → `/register/step-6`, sinon `/register/step-7`.
- Précédent : `/register/step-4-open` ou `/register/step-4-conditional` selon `team.registrationStatus`.

### Step 6 — Transfer Letter (`Step6TransferLetter.vue`)

- **Au mount, si `!currentDraft.previouslyLicensed`, redirige immédiatement vers `/register/step-7`.**
- Banner strong rouge sur l'importance du document.
- `<DocumentUploadTile @pick="onPick">`. Sur `@pick(file)`, appelle `uploadFile(file, \`registrations/${currentDraftId}/transferLetter.pdf\`)` (cf. `repositories/storage.ts`), suit la progression, puis `patchDraft({ transferLetterStoragePath: path })`.
- Si `currentDraft.previousClubAbroad === true` → banner ambre "Transfert international détecté".
- Continuer **toujours actif** (upload optionnel). Cible suivante : `/register/step-7`.

### Step 7 — License Info (`Step7LicenseInfo.vue`)

- Statique : 3 cards documents (carte ID, formulaire, lettre de sortie), 3 cards conditions, phrase finale italique.
- Bouton "Soumettre mon inscription" → `useRegistrationsStore().submit({...})` (lit tout depuis `currentDraft`). Sur succès → `router.replace({ name: 'wiz-done', params: { registrationId: out.id } })`. Sur erreur → banner-strong en haut.
- Précédent : `/register/step-6` si `previouslyLicensed`, sinon `/register/step-5`.
- État loading sur le bouton pendant la callable (spinner inline).

### Step 8 — Confirmation (`Step8Confirmation.vue`)

- **Pas de `WizardLayout`** : utilise `.m-app` directement, c'est terminal (pas de bouton précédent).
- Au mount, `loadRegistration(route.params.registrationId)`. Affiche check vert XL, titre "Inscription envoyée", card récap (joueur, équipe, statut, réf `REG-...`), banner-info sur email envoyé.
- CTA primaire "Revenir à mes inscriptions" → `/home`. CTA secondaire "Inscrire un autre joueur" → `clearDraft()` puis `/register/step-1`.

## 5. Playbook — ajouter ou modifier une étape

1. **Lire le contexte d'abord** : `docs/registrations/overview.md`, `lifecycle.md`, `schema.md` pour comprendre l'état attendu côté serveur. `docs/registrations/functions.md` pour les callables disponibles.
2. **Localiser la référence visuelle** : `<template id="tpl-eN">` dans `/tmp/courtbase-register-design/courtbase-desktop-vuejs-avec-vueframe/project/register/Courtbase Register.html` (si le bundle est encore extrait localement — sinon, skip ou retélécharger via la mémoire `design_bundle_import`).
3. **Créer / éditer le fichier** `apps/courtbase-register/src/views/register/StepN<Name>.vue` en `<script setup lang="ts">` + scoped styles uniquement pour les surcouches locales.
4. **Wrapper dans `<WizardLayout :current="N" title="…">`** avec `<template #footer>` pour les boutons Précédent / Continuer. Exception : Step8Confirmation utilise `.m-app` direct.
5. **Persister via le store AVANT navigation** : `useRegistrationsStore().patchDraft({...})` puis `router.push('/register/step-X')`. Jamais l'inverse.
6. **Lucide icons** : `import { ArrowRight, ChevronLeft } from 'lucide-vue-next'`. Pas de `<i data-lucide>`.
7. **PrimeVue autorisé** pour : `<InputText>`, `<Select>`, `<Password>`, `<Toast>`. Sinon atoms CSS (`.btn`, `.input`, `.card`, etc. — cf. `design-to-vue-register.md` §4 pour le tableau de décision).
8. **Au mount, redirige `/register/step-1` si `currentDraft === null`** (état perdu après refresh + sessionStorage vide).
9. **Vérifier** : `npm run type-check -w @club-app/courtbase-register` doit passer avant de committer.

### Anti-patterns à éviter

- Importer le SDK Firebase ou `services/cloudFunctions.ts` directement depuis une vue ou un composant — toujours passer par un store Pinia.
- Lire `auth.hasProfile` ou `auth.userDoc` immédiatement après `await auth.signInWithGoogle()` — utiliser les wrappers du store qui attendent la résolution.
- Dupliquer un atome CSS dans un `<style scoped>` — si l'atome manque, l'ajouter dans `style.css` partagé.
- Utiliser `<Drawer position="bottom">` PrimeVue pour les bottom-sheets — préférer le markup `.modal-overlay` + `.modal-sheet` natif (plus de contrôle sur z-index et animation, cf. `MatchFoundDialog.vue`).

## 6. État livré — snapshot 2026-05-14

Phase C complète :

- 9 vues du wizard (Step1Whoami → Step8Confirmation) en place.
- `WizardLayout` + `Stepper` + 4 composants partagés (`TeamCard`, `DocumentUploadTile`, `RelationshipPicker`, `MatchFoundDialog`) livrés.
- Persistance `currentDraftId` via sessionStorage opérationnelle.
- Suppression de drafts : Home → icône poubelle de chaque card draft appelle `useRegistrationsStore().removeDraft(id)` (deleteDoc direct ; les rules Firestore autorisent `delete` par l'auteur si `status === 'draft'`). La callable `cancelRegistration` ne marche que sur `submitted+`.
- Tri en JS plutôt que `orderBy` Firestore pour `listEligibleTeams` et `listMyRegistrations` (évite les index composites, tolère les `serverTimestamp` non résolus).

Reste à traiter dans les phases ultérieures :

- Guard de continuité (Phase D) : aujourd'hui on permet la navigation libre entre étapes ; un guard pourrait forcer à reprendre à la première étape incomplète.
- Phase D — Documents licence (`/license/:registrationId/documents`).
- Phase E — Modal devenir majeur (overlay sur Home).

## 7. Liens

- `docs/registrations/overview.md`, `schema.md`, `functions.md`, `lifecycle.md` — autres briefs du chantier inscriptions.
- `docs/design-to-vue-register.md` — atoms CSS et conversion claude.design → Vue.
- `apps/courtbase-register/CLAUDE.md` — règles spécifiques de l'app.
- Mémoires : `[[project-registrations-chantier]]`, `[[deploy-functions-v2-invoker-binding]]`.
