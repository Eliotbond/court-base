# Gestion des inscriptions — `courtbase-app` (coach)

> Brief produit pour le sous-chantier **inscriptions** dans la companion app mobile-first `courtbase-app`. Stack, conventions et architecture générales : [`docs/courtbase-app.md`](../courtbase-app.md). Lifecycle des statuts manipulés : [`./lifecycle.md`](./lifecycle.md). Sigs des callables consommées : [`./functions.md`](./functions.md).
>
> Référence fonctionnelle desktop : `apps/web/src/views/Inscriptions.vue` (drawer in-page, scope auto par rôle). Le design mobile diffère — la logique métier est identique.

## 1. Pourquoi cet écran

Le coach a besoin de gérer ses inscriptions **depuis le terrain**, en bord de training : marquer un joueur en essai juste après l'avoir vu jouer, confirmer son intégration la semaine suivante, ou refuser sans détour quand le créneau ne colle pas. Ouvrir `apps/web` (admin desktop) depuis un téléphone pour faire ces 3 actions est dissuasif. Cet écran porte cette feature dans la stack mobile-first cohérente avec le reste de la mission `courtbase-app` (cf. [`docs/courtbase-app.md`](../courtbase-app.md) §"Pourquoi cette app").

Aucune nouvelle Cloud Function — les 3 callables (`markTrialInProgress`, `confirmRegistration`, `refuseRegistration`) sont déjà déployées et utilisées par l'admin desktop.

## 2. Routes & entry points

| Route | Composant | Rôle requis | Sens |
|---|---|---|---|
| `/registrations` | `views/RegistrationsList.vue` | `coach`, `admin` | Liste des inscriptions de ses équipes (admin → toutes). |
| `/registrations/:id` | `views/RegistrationDetail.vue` | `coach`, `admin` | Détail plein écran d'une inscription. |

Les deux routes sont ajoutées à la liste `coach` (et `admin`) de l'allowlist router (cf. [`docs/courtbase-app.md`](../courtbase-app.md) §"Shell restreint").

**Entrées dans l'app** :

- **Tab bar coach** : icône `ClipboardList` ("Inscriptions"). Badge **rouge non-lu** = count des registrations en `submitted` + `conditional_pending_review` + `trial_in_progress` arrivant à terme (≤ 2 j restants sur le compteur 14 j) parmi les équipes du coach.
- **Home coach** : item "Inscriptions à traiter" dans la section "Actions" si `submitted + conditional_pending_review > 0`. CTA → `/registrations` chip "À traiter" pré-sélectionné.
- **Deep-link push** : `notification.deepLink = '/registrations/{id}'` quand le trigger `onRegistrationStatusChanged` crée une notif `new_registration_open` ou `new_registration_conditional`. Aussi consommé par `trial_expired_alert` (cf. §7).

## 3. Écran 1 — Liste inscriptions

### Layout (mobile, 375 px de base)

- **Header sticky** (`<header class="app-header">`) : back arrow vers home, titre "Inscriptions", sous-titre count "{n} inscription(s) · {scope}". Pas de bouton "+". L'inscription est créée par les parents via `courtbase-register`, pas par le coach.
- **Barre filtres horizontale scrollable** (`overflow-x-auto`, snap-x) : chips status avec compteurs.
- **Liste verticale** de cards, séparateurs `border-b`. Pull-to-refresh actif (cf. roadmap Phase 6 `docs/courtbase-app.md`).
- **Sticky footer bar** : invisible ici (réservée au détail).

### Chips status

Un seul chip actif à la fois (radio-style), comme `apps/web` (`RegistrationQuickFilter`).

| Chip id | Libellé | Mapping statuts (cf. `lifecycle.md`) |
|---|---|---|
| `submitted` | À traiter (count) | `submitted` + `conditional_pending_review` |
| `trial` | Essai en cours | `open_pending_trial` + `conditional_pending_trial` + `trial_in_progress` |
| `done` | Confirmées | `confirmed_pending_dues` + `active` |
| `terminal` | Refusées / annulées | `refused` + `cancelled` |
| `all` | Toutes | (tous sauf `draft`) |

Compteurs **calculés sur le dataset complet** (pas filtré par équipe ni recherche) — cohérent avec le store admin. Chip par défaut au montage : **`submitted`** (le coach ouvre l'écran pour traiter du neuf).

### Filtre équipe (multi-équipes uniquement)

Si `auth.userDoc.teamIds.length > 1`, afficher un `Select` PrimeVue (mobile-friendly, fullscreen sur tap) au-dessus de la liste avec les options "Toutes mes équipes / {team A} / {team B} / …". Si le coach a une seule équipe : pas de filtre.

Pas de filtre par catégorie ni par genre — déjà implicite via le filtre équipe.

### Card row

```
┌────────────────────────────────────────────────┐
│ [Avatar 40px]  Prénom Nom              [Pill]  │
│                {team name}  ·  il y a 3 j     │
│                Transfert étranger (badge amber si flag)│
└────────────────────────────────────────────────┘
```

- **Avatar** : initiales (`name`) à défaut de photo. Cohérent avec `apps/web` (`<Avatar :name=…>`).
- **Nom complet** : `firstName + lastName` (`playerFullName` côté repo).
- **Méta-ligne** : nom équipe (pill couleur catégorie, cf. `categories.repo.ts`) · date soumission relative ("À l'instant", "Il y a 3 min", "Il y a 2 h", "Il y a 3 j", au-delà → date FR courte).
- **Pill statut** alignée à droite, couleur `registrationStatusVariant()` (cf. helpers existants — réutiliser tel quel) : `emerald` / `amber` / `slate` / `rose`.
- **Badges secondaires** sous le nom (taille 11 px) : `Transfert étranger` (amber) si `foreignTransfer === true` ; `Déjà licencié` (slate) si `previouslyLicensed`.
- **Tap target ≥ 60 px** de hauteur effective. Tap → push `/registrations/:id`.

### États

- **Loading initial** : skeleton 3 rows (cohérent avec `Step3TeamPicker.vue` du wizard register).
- **Empty state** (scope coach, pas de résultats) : illustration discrète + texte *"Aucune inscription en attente pour vos équipes."* — pas de CTA (le coach ne déclenche pas la création).
- **Empty state filtré** : *"Aucun résultat dans ce filtre"* + lien "Voir toutes".
- **Erreur** : bandeau rose en haut de la liste, texte court + bouton "Réessayer".

### Sort

1. Statuts prioritaires d'abord (par bucket) : `À traiter` > `Essai` > `Confirmées` > `Terminales`.
2. À l'intérieur d'un bucket : `createdAt` desc.

Tri 100 % côté JS — pas d'index Firestore composite supplémentaire à déployer (volumes < 100 docs par coach, cf. règle `CLAUDE.md` racine §10).

## 4. Écran 2 — Détail registration

Page **plein écran** (pas drawer, on est mobile). Back arrow header → `router.back()` ou `/registrations` si pas d'historique.

### Header

- Avatar (56 px) + nom + sous-titre "{team name} · {age} ans".
- À droite du header : pas de menu kebab. Les actions vivent dans le footer sticky (cf. §4 fin).

### Sections (scroll vertical, padding 16 px latéral)

#### Statut

- **Pill grande taille** (taille 14 px, padding plus généreux qu'en liste).
- **Badges secondaires** côte à côte : `Transfert étranger` (amber), `Déjà licencié` (slate), `Essai démarré il y a {n} j` (sky) si `trial_in_progress` (calcul JS : `now - trialStartedAt`).
- **Card motif de refus** (visible si `refusalReason != null`) : fond jaune (`bg-amber-50 border-amber-200`), label "Motif de refus" + texte multi-ligne.

#### Identité joueur

`<dl class="grid grid-cols-2">` mobile-friendly (label + valeur, 2 colonnes étroites).

- Date de naissance (`formatBirthDate`).
- Âge (calculé JS).
- Genre (`M` → "Masculin" / `F` → "Féminin" / `other` → "Autre").
- Téléphone joueur (icône `Phone`, link `tel:` si présent).
- AVS **semi-masqué** : `756.xxxx.xxxx.95` (afficher préfixe `756` + 2 derniers chiffres). Pas de copy-to-clipboard (donnée sensible, le coach n'en a pas besoin terrain).

Pill emerald "Lié à un membre existant" si `matchedMemberId != null`.

#### Contexte soumission

- "Soumise par {relationship}" — réutiliser `relationshipLabel()` (cf. `Inscriptions.vue` lignes 141-157, à porter dans le repo `courtbase-app`).
- Date relative + date absolue (tap pour basculer).

#### Historique sportif (visible si `previouslyLicensed || previousClubName`)

- Ancien club + flag étranger.
- Lettre de sortie : nom de fichier + bouton download si `transferLetterStoragePath`. Open via `getDownloadURL` direct (rule storage autorise read sur path `/transferLetters/{regId}/*` côté coach).

#### Journal d'actions

5 dernières entrées `actionLog`, ordre antichronologique. Chaque entrée : timestamp relatif + action + note. Voir snippet `Inscriptions.vue` lignes 815-848 pour le format.

### Footer fixe (sticky bottom)

Hauteur ≥ 64 px, padding 12 px, `box-shadow` léger vers le haut, fond surface-0. Boutons côte à côte selon helpers `isMarkTrialPossible` / `isConfirmable` / `isRefusable` (à réimporter ou réimplémenter, source de vérité = `apps/web/src/repositories/registrations.repo.ts`).

| Statut courant | Boutons visibles |
|---|---|
| `submitted` | (aucun — attendre que le wizard décide open/conditional ; n'arrive jamais en pratique côté coach) |
| `open_pending_trial` | **Démarrer l'essai** (primary) · **Refuser** (secondary destructive) |
| `conditional_pending_review` | **Démarrer l'essai** (primary, collapse "accept") · **Refuser** |
| `conditional_pending_trial` | **Démarrer l'essai** (primary) · **Refuser** |
| `trial_in_progress` | **Confirmer** (primary emerald) · **Refuser** |
| `confirmed_pending_dues` | (aucun — état post-confirmation, en attente paiement) |
| `active`, `refused`, `cancelled` | (aucun — terminaux) |

Chaque bouton a une zone tactile ≥ 48×48 px (Apple HIG / Material). Tap → ouvre le bottom-sheet correspondant (§5).

## 5. Écran 3 — Bottom-sheets d'action

Pattern : `<Dialog>` PrimeVue configuré en mode **bottom sheet** (transition slide-up, position bottom, full-width, top rounded `rounded-t-2xl`). Backdrop tap → close. Pas de modal centrée — incompatible avec une saisie pouce sur mobile.

Toutes les actions appellent les callables existantes via les wrappers `services/cloudFunctions.ts` (à porter depuis `apps/web/src/services/cloudFunctions.ts` — pattern identique : `httpsCallable(getFunctions(app, 'europe-west6'), 'xxx')`).

Try/catch défensif obligatoire (cf. `CLAUDE.md` racine §9), avec toast PrimeVue (`useToast()`) sur erreur/succès.

### 5.a "Démarrer l'essai" (`markTrialInProgress`)

**Header** : "Démarrer l'essai".

**Body** :

> L'essai démarre **maintenant**. Vous avez **14 jours** pour confirmer l'intégration ou refuser l'inscription.
>
> - **Si vous confirmez** : la cotisation est émise immédiatement, avec une date d'échéance fixée à **J+14 depuis aujourd'hui**.
> - **Si vous refusez** : l'inscription est close (motif obligatoire).
>
> Vous recevrez une notification de rappel à l'expiration de l'essai si rien ne bouge.

Card info bleue (`bg-sky-50 border-sky-200`) avec icône `CalendarClock` : "Le démarrage est notifié au parent qui a soumis l'inscription."

**Footer** : `Annuler` (secondary) · `Démarrer l'essai` (primary).

**Loading** : spinner inline sur le bouton primary, label "Démarrage…". Désactive les deux boutons.

**Idempotence** : la callable serveur ne réinitialise pas `trialStartedAt` (cf. [`functions.md`](./functions.md#25-marktrialinprogress)). Pas de garde côté UI nécessaire — un double-tap est sans dommage.

### 5.b "Confirmer l'intégration" (`confirmRegistration`)

**Header** : "Confirmer l'intégration".

**Body** — branchement sur `matchedMemberId` :

- **Cas 1 (nouveau member)** :
  > **{firstName} {lastName}** sera créé(e) comme **nouveau membre** dans le club.
- **Cas 2 (matched member existant)** :
  > L'inscription sera rattachée au **membre existant** ({memberId tronqué)}.

Puis (les deux cas) :

> Le joueur est ajouté à l'effectif de **{team name}**. La cotisation est émise **immédiatement** ; le parent reçoit l'email "à payer" avec échéance à J+14 depuis le démarrage de l'essai.
>
> Vous pouvez confirmer **même si le paiement n'est pas encore reçu** — la cotisation devient payable, c'est la prochaine étape.

Card info emerald (`bg-emerald-50 border-emerald-200`) avec icône `CircleCheck` : "Statut final : `confirmed_pending_dues`. Passera en `active` dès paiement reçu."

**Footer** : `Annuler` (secondary) · `Confirmer` (primary emerald).

**Edge cases** :

- Si le callable rejette en `permission-denied` (coach pas dans `team.coachIds`) → toast erreur "Vous n'êtes plus coach de cette équipe" + close.
- Si `not-found` (registration supprimée entre-temps) → toast + back vers liste.

### 5.c "Refuser l'inscription" (`refuseRegistration`)

**Header** : "Refuser l'inscription".

**Body** :

- Textarea motif **obligatoire** (min 5 chars après trim — validation client + server). Placeholder : "Ex. catégorie pleine, niveau insuffisant, contraintes horaires…". `auto-resize`, rows initial 4.
- Card warning amber (`bg-amber-50 border-amber-200`) avec icône `TriangleAlert` :
  > Le motif est consigné dans le journal de l'équipe (`/teams/{id}/refusalLogs`) et **visible par le parent**.
  >
  > Un email automatique + notification push sont envoyés au parent. Si une autre équipe de la même catégorie est ouverte, l'inscription pourra être **re-routée automatiquement** par le système (cf. trigger `onRegistrationRefused`).

**Footer** : `Annuler` (secondary) · **`Refuser`** (primary `bg-rose-600 hover:bg-rose-700`, label destructive).

**Validation** : si motif < 5 chars trim → border rose sur textarea + message "Motif requis (sera visible par le parent)". Bouton primary disabled.

## 6. Stores + repos (couches à respecter)

Cf. `docs/courtbase-app.md` §"Stack" — architecture en couches `components → composables → stores → repositories → Firebase`.

### `apps/courtbase-app/src/repositories/registrations.repo.ts`

- Réimplémenter `listRegistrationsForTeams(teamIds: readonly string[])` — pattern identique à `apps/web` (une query par teamId, merge + sort JS, `where('status','in', NON_DRAFT_STATUSES)`, `limit(200)`).
- Types `RegistrationRow`, `RegistrationTeamRef` importés via `@club-app/shared-types`.
- Helpers de variant/label/transition (`isMarkTrialPossible`, `isConfirmable`, `isRefusable`, `registrationStatusLabel`, `registrationStatusVariant`) : **port à l'identique** depuis `apps/web/src/repositories/registrations.repo.ts` — ces fonctions sont pures, pas de dépendance Firebase, dupliquer est moins coûteux qu'un package partagé pour 5 fonctions.

### `apps/courtbase-app/src/stores/registrations.ts`

- Pinia composition store, scopé coach par défaut (`isAdminScope = auth.roles.includes('admin') || auth.rootAdmin`).
- État identique au web (`items`, `loading`, `error`, `quickFilter`, `teamFilter`, `search`, `actionPendingId`) — adapter le `search` minimal côté mobile (pas de barre de recherche en MVP ; on l'expose en tant qu'API mais on n'instancie pas d'input).
- Actions `markTrial`, `confirmToDues`, `refuse` — pattern try/catch `FirebaseError` + reload après succès. Pas d'optimistic update (les transitions de statut viennent du server, on relit).

### `apps/courtbase-app/src/services/cloudFunctions.ts`

- Wrappers fins typés :
  ```ts
  export const markTrialInProgress = httpsCallable<
    { registrationId: string },
    { ok: true }
  >(getFunctions(app, 'europe-west6'), 'markTrialInProgress')
  ```
- Pareil pour `confirmRegistration` et `refuseRegistration`. Région `europe-west6` obligatoire (sinon SDK appelle `us-central1` → 404 cryptique).

### Toast UX

Utiliser `useToast()` PrimeVue dans le store (passé en arg ou via `ToastService` global). Messages courts :

- Succès markTrial : "Essai démarré"
- Succès confirm : "Joueur confirmé — cotisation émise"
- Succès refuse : "Inscription refusée"
- Erreur : "{message} ({code})" — l'utilisateur a besoin du code pour reporter au support.

## 7. Notifications push

Couvert par le trigger backend `onRegistrationStatusChanged` (cf. [`functions.md`](./functions.md#31-onregistrationstatuschanged)) — pas de nouvelle Cloud Function à écrire.

| Trigger | Audience | Notif type | Deep-link reçu |
|---|---|---|---|
| Parent soumet une registration (open) | Coach + admin de la team | `new_registration_open` | `/registrations/{id}` |
| Parent soumet (conditional) | Coach + admin de la team | `new_registration_conditional` | `/registrations/{id}` |
| `onTrialExpired` détecte essai > 14 j | Coach + parent | `trial_expired_alert` | `/registrations/{id}` (statut `trial_in_progress`) |

**Comportement côté `courtbase-app`** :

- Si l'app est **ouverte** : toast PrimeVue in-app + badge tab bar incrémenté + son optionnel.
- Si l'app est **en background** (Android Chrome / iOS PWA installée) : push system tray native du device (Service Worker), tap → `clients.openWindow(deepLink)`.
- À l'open de la deep-link : `router.push(deepLink)` → si l'utilisateur n'est pas signed-in, on stocke le deep-link dans `sessionStorage` et on redirige après auth.

**Pas de notif locale planifiée** — le timing 14 j est porté par le scheduled `onTrialExpired` côté backend (cf. [`docs/courtbase-app.md`](../courtbase-app.md) §"Ce qu'on perd / regagne").

## 8. Hors-scope MVP

- **Accept conditional dédié** (étape intermédiaire `conditional_pending_review → conditional_pending_trial` sans démarrer l'essai). On collapse vers `markTrialInProgress` directement, cohérent avec la spec actuelle ([`functions.md`](./functions.md#25-marktrialinprogress) §"Note design").
- **Bulk actions** (refuser 5 inscriptions d'un coup). Pas un besoin terrain.
- **Filtre par catégorie d'équipe** — déjà implicite via le filtre équipe (un coach a rarement plusieurs catégories).
- **Export CSV** — réservé à l'admin desktop.
- **Suppression définitive** (`deleteRegistration`) — admin uniquement, reste sur `apps/web`. Pas d'expo mobile.
- **Re-routing manuel** (basculer une registration vers une autre équipe) — pas exposé côté coach, géré par le trigger backend.
- **Édition des données du joueur** (nom / DOB / AVS) — passe par `apps/web` admin. Le coach ne corrige pas les données du wizard.

## 9. Cohérence design system

- **Atoms** réutilisés depuis le design system `courtbase-app` (Pill, Card, BottomSheet, Skeleton, Avatar). Pour le démarrage : reprendre les variantes CSS de `apps/courtbase-register` (atoms portés depuis `claude.design`) et les harmoniser avec le shell PrimeVue de `courtbase-app`.
- **Couleurs Pills par statut** : source de vérité = `registrationStatusVariant()` (port direct depuis `apps/web/src/repositories/registrations.repo.ts`, lignes 273-293). Mapping : emerald (ok) / amber (warning) / slate (neutre) / rose (erreur).
- **Touch targets** ≥ 48 × 48 px partout. Buttons : `min-h-12 px-4`. Card row : `min-h-[60px] py-3 px-4`.
- **Tap feedback** : `active:bg-surface-100` sur les rows + cards tappable.
- **Pas de modale centrée plein écran** — bottom sheets pour les actions, page plein écran pour le détail. Cohérent avec l'orientation portrait dominante.
- **Typographie** : `text-[15px]` pour le corps de carte, `text-[13px]` pour les méta, `text-[11px]` uppercase tracking-wide pour les section headers (aligné `apps/web`).
- **Iconographie** : `lucide-vue-next` (déjà utilisé partout dans le monorepo). `ClipboardList` pour l'entrée tab bar, `CalendarClock` pour démarrer l'essai, `CircleCheck` pour confirmer, `Ban` pour refuser.

## 10. Critères de done

- [ ] Liste affichée bout-en-bout (Firestore live, scope coach), chips status fonctionnels avec compteurs corrects.
- [ ] Détail plein écran lisible avec toutes les sections + footer d'actions conditionné aux helpers `isMarkTrialPossible` / `isConfirmable` / `isRefusable`.
- [ ] 3 dialogs bottom-sheet (mark trial / confirm / refuse) opérationnels, callables wrappés en région `europe-west6`, try/catch enrichi `FirebaseError`.
- [ ] Toast PrimeVue sur succès / erreur, état `actionPendingId` propre (boutons disabled pendant l'action).
- [ ] Notifs push FCM ouvrent le bon écran via deep-link (testé Android Chrome + iOS PWA installée).
- [ ] `npm run typecheck -w @club-app/courtbase-app` passe.
- [ ] `npm run lint -w @club-app/courtbase-app` passe.
- [ ] Test manuel terrain : créer une inscription test depuis `courtbase-register` → push reçue par le coach → ouvrir → markTrial → confirm → vérifier que la cotisation apparaît dans `apps/web` côté admin.

## 11. Documents liés

- [`./lifecycle.md`](./lifecycle.md) — les 10 statuts + transitions.
- [`./functions.md`](./functions.md) — sigs des 3 callables consommées.
- [`./schema.md`](./schema.md) — modèle Firestore `/registrations`.
- [`../courtbase-app.md`](../courtbase-app.md) — stack, conventions, architecture générale de l'app.
- [`../firebase.md`](../firebase.md) — schéma global Firestore + rules.
- [`apps/web/src/views/Inscriptions.vue`](../../apps/web/src/views/Inscriptions.vue) — référence fonctionnelle desktop (drawer in-page).
- [`apps/web/src/repositories/registrations.repo.ts`](../../apps/web/src/repositories/registrations.repo.ts) — helpers à porter à l'identique.
- [`apps/web/src/stores/registrations.ts`](../../apps/web/src/stores/registrations.ts) — pattern Pinia à reproduire mobile.
