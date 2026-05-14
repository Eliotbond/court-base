# Guide de conversion claude.design → Vue (app `courtbase-register`)

> Comment prendre un bundle exporté depuis claude.design/ai et l'implémenter en Vue 3 + PrimeVue + Tailwind dans `apps/courtbase-register/`.
>
> Bundle de référence : `Courtbase Desktop VueJS avec VueFrame` (URL `api.anthropic.com/v1/design/h/zwHwR94pDJb7mKazcElCuw`, fichier visé `register/Courtbase Register.html`, 19 écrans mobile-first 375px).
>
> Briefs source : `docs/design-brief-register.md` (brief envoyé à l'assistant design) + `docs/chantier-registrations.md` (spec produit). Mockups admin associés : voir mémoire `design_bundle_import` — **prudence**, les écrans admin couvrent des domaines proches (équipes, members, licences) mais vivent dans `apps/web`, pas ici.

## 0. Le format claude.design en quelques lignes

Un bundle exporté est un `.tar.gz` qui contient :

```
{project-slug}/
├── README.md              ← instructions à l'agent (à lire EN PREMIER)
├── chats/                 ← transcripts des itérations avec le designer
│   ├── chat1.md
│   └── …
└── project/               ← les fichiers HTML/CSS/JS auto-portants
    ├── *.html             ← un fichier par "famille d'écrans"
    └── uploads/           ← briefs originaux uploadés par l'utilisateur
```

Chaque HTML est un **prototype navigable** : un seul fichier auto-portant avec Tailwind via CDN, Lucide icons, `<template id="tpl-eN">` pour chaque écran, et un `<script>` qui injecte les templates dans un `<section class="screen">`. **Ce n'est pas du code de production** — c'est une maquette à reproduire visuellement, pas à transpiler ligne à ligne.

### Ce qui transite directement

| Élément du prototype | Côté Vue |
|---|---|
| Tokens (`surface-200`, `emerald-700`, etc.) | Tailwind config (déjà alignée — cf. `tailwind.config.js`) |
| Atoms (`.btn`, `.input`, `.pill`, `.chip`, `.card`, `.toggle`, `.radio-card`, `.choice-card`, `.team-card`, `.doc-tile`, `.stepper`, `.banner`, `.m-*`, `.brand-mark`) | `src/style.css` — repris **tels quels** comme couche CSS partagée |
| Icônes Lucide (`<i data-lucide="…">`) | `<IconName />` depuis `lucide-vue-next` |
| Composants Lucide SVG OAuth (Google, Apple) | Inlinés dans le composant Vue concerné |
| Le shell mobile (bezel iPhone, status bar, nav rail, inspecteur) | **À ignorer** — c'est le harnais de présentation du prototype, pas l'app |

### Ce qui change

- **Routing** : chaque `<template id="tpl-eN">` devient une **route Vue** (`/`, `/signin`, `/profile`, `/home`, plus tard `/register/step-1`…) — pas un toggle de visibilité.
- **State** : les `data-go="eN"` du prototype simulent un flow. En Vue, l'état du wizard vit dans un store Pinia (futur `stores/registration.ts`), pas dans le DOM.
- **PrimeVue** : préférer un composant PrimeVue (`Button`, `Select`, `Toast`, `Dialog`, `Drawer`) quand un atom HTML peut être remplacé. Sinon, atom CSS du `style.css` (cas des `.choice-card`, `.team-card`, `.doc-tile`, `.stepper` — pas de composant PrimeVue équivalent).
- **Formulaires** : `<input>` natifs du prototype → `InputText` / `Select` / `Password` PrimeVue. Garder les classes `.input` / `.label` / `.helper` / `.helper-error` du `style.css` pour la cohérence visuelle quand PrimeVue ne fit pas.

## 1. Lecture d'un bundle — playbook

À chaque nouveau bundle ou nouvelle version :

1. **Lire `README.md`** du bundle — il dit quel fichier était ouvert au moment du handoff (= la priorité).
2. **Lire tous les `chats/chat*.md`** — c'est là que vit l'intention, les questions tranchées, les arbitrages. Le HTML est l'output ; les chats expliquent **pourquoi**.
3. **Lire `project/uploads/design-brief-*.md`** — c'est le brief envoyé par le user. Recouvre/complète `docs/chantier-*.md`.
4. **Lire le HTML cible en entier**, pas en diagonale. Repérer :
   - Liste `SCREENS` dans le `<script>` final (titres + sous-titres + notes design).
   - Atoms définis dans le `<style>` du `<head>`.
   - Templates `tpl-*` qui matchent les écrans listés dans le brief.
5. **Mapper chaque écran à une route Vue ou à un sous-composant**.

## 2. Mapping écrans → Vue (bundle actuel)

Le bundle `register/Courtbase Register.html` contient 19 écrans. Voici comment ils s'implémentent :

| # | Écran prototype | Route Vue | Statut |
|---|---|---|---|
| E1 | Landing publique | `/` (`views/Landing.vue`) | ✅ implémenté |
| E2 | Sign-in / Sign-up email | `/signin` (`views/SignIn.vue`) | ✅ implémenté |
| E3 | Profil 1ʳᵉ connexion | `/profile` (`views/ProfileSetup.vue`) | ✅ implémenté |
| E4 | Home — mes inscriptions | `/home` (`views/Home.vue`) | ✅ shell implémenté (cards mockées, sera câblé sur store quand registrations existent) |
| E4⌀ | Home — empty | même route, branche conditionnelle | ✅ géré dans `Home.vue` |
| E5 | Wizard 1/8 — Pour qui ? | `/register/step-1` (à créer) | 🚧 Phase C |
| E6 | Wizard 2/8 — Identité + AVS | `/register/step-2` (à créer) | 🚧 Phase C |
| E7 | Modal match trouvé | composant `<MatchFoundDialog>` ouvert depuis step-2 | 🚧 Phase C |
| E8 | Wizard 3/8 — Choix équipe | `/register/step-3` (à créer) | 🚧 Phase C |
| E8↻ | Loading skeleton | branche conditionnelle de step-3 | 🚧 Phase C |
| E8⌀ | Empty state | branche conditionnelle de step-3 | 🚧 Phase C |
| E9 | Wizard 4a/8 — Manuel équipe ouverte | `/register/step-4` (variante open) | 🚧 Phase C |
| E10 | Wizard 4b/8 — Conditions équipe | `/register/step-4` (variante conditional) | 🚧 Phase C |
| E11 | Wizard 5/8 — Contact + historique | `/register/step-5` | 🚧 Phase C |
| E12 | Wizard 6/8 — Lettre de sortie | `/register/step-6` (conditionnel) | 🚧 Phase C |
| E13 | Wizard 7/8 — Info licence | `/register/step-7` | 🚧 Phase C |
| E14 | Wizard 8/8 — Confirmation | `/register/confirmation/:registrationId` | 🚧 Phase C |
| E15 | Documents licence | `/license/:registrationId/documents` | 🚧 Phase D |
| E15↻ | Upload en cours | état interne du même écran | 🚧 Phase D |
| E16 | Modal devenir majeur | composant `<BecomeMajorDialog>` (overlay sur Home) | 🚧 Phase E |

> **Conventions de nommage** : un fichier Vue par route, en `PascalCase`. Pour le wizard, un dossier `views/register/` contiendra `Step1Whoami.vue`, `Step2Identity.vue`, etc. Les dialogs vivent dans `components/dialogs/`.

## 3. Mapping atoms → CSS

Les atoms du prototype ont été portés dans `src/style.css` **tels quels** (mêmes class names, mêmes tokens). Tu peux donc copier-coller la structure HTML d'un écran du prototype et obtenir 90% du rendu correct sans toucher au CSS. Liste des atoms disponibles :

### Boutons et inputs
- `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-text`, `.btn-sm`, `.btn-xs`, `.btn-block`
- `.input`, `.input.with-icon-left`, `.input.error`, `.input-wrap` (positionne une icône à gauche)
- `.label`, `.helper`, `.helper-error`

### Pills, chips, cards
- `.pill` + variantes : `.pill-emerald` `.pill-sky` `.pill-amber` `.pill-rose` `.pill-slate` `.pill-violet`
- `.chip` (border + fond blanc)
- `.card` (12px radius, ombre légère), `.card-flat` (10px radius, sans ombre)
- `.avatar` (cercle 32px par défaut, surchargable via `!w-* !h-*`)
- `.brand-mark` + `.brand-mark-lg` (logo club, "M" pour Marly Basket dans les mocks)

### Composants spécifiques
- `.toggle` / `.toggle.on` (switch émeraude)
- `.radio-card` / `.radio-card.selected` (carte cliquable avec dot)
- `.choice-card` / `.choice-card.selected` (grande carte de choix, E5)
- `.team-card` / `.team-card.disabled` (E8)
- `.doc-tile` / `.doc-tile.uploaded` / `.doc-tile.refused` / `.doc-tile.uploading` (E12, E15)
- `.stepper` + `.stepper-dots` + `.step-dot[.done|.current]` + `.stepper-label` (wizard)
- `.banner` + variantes : `.banner-info` `.banner-warn` `.banner-strong` `.banner-soft` `.banner-success`
- `.modal-overlay` + `.modal-sheet` + `.modal-grabber` (bottom sheets E7 + E16)

### Shell mobile (m-*)
- `.m-app` (colonne flex, hauteur de l'écran téléphone)
- `.m-header` (bandeau 52px sticky)
- `.m-content` (zone scrollable avec padding bottom pour la safe area)
- `.m-bottom` (CTA sticky bottom)

> **Important** : ces atoms `.m-*` simulent un téléphone dans le prototype. En production, l'app **est** sur téléphone — donc on garde la grammaire `.m-app` / `.m-header` / `.m-content` / `.m-bottom`, mais sans le bezel iPhone. La largeur max est gérée au niveau du shell de l'app dans `App.vue`.

### Skeleton + animations
- `.sk` (shimmer skeleton pour loading states)
- `.barmini` (mini progress bar inline)

## 4. Mapping atoms → PrimeVue

Quand un atom est aussi un composant PrimeVue, **préférer PrimeVue** pour l'accessibilité et la cohérence avec `apps/web`. Sinon, garder l'atom CSS.

| Atom prototype | PrimeVue | Décision |
|---|---|---|
| `.btn-primary` simple | `<Button label="…" />` | ✅ PrimeVue |
| `.btn-primary` avec icône Lucide custom | `.btn-primary` + `<IconName />` | atom CSS (PrimeVue n'accepte que PrimeIcons) |
| Input texte simple | `<InputText />` | ✅ PrimeVue |
| Input avec icône à gauche | `.input-wrap` + atom CSS | atom CSS (les variantes PrimeVue 4 sont verbeuses) |
| Select | `<Select />` | ✅ PrimeVue |
| Password | `<Password />` | ✅ PrimeVue |
| `.modal-overlay` bottom sheet | `<Drawer position="bottom" />` | ✅ PrimeVue |
| Card pour layout | atom `.card` | atom CSS (le `<Card>` PrimeVue ajoute trop de padding) |
| Toast d'erreur transient | `<Toast />` + `useToast()` | ✅ PrimeVue (à wire dans `main.ts` quand on en aura besoin) |
| `.pill-*` | aucun équivalent | atom CSS |
| `.chip` | aucun équivalent | atom CSS |
| `.stepper` mobile | aucun équivalent | atom CSS |
| `.doc-tile` | aucun équivalent | atom CSS |

## 5. Lucide icons

Le prototype utilise Lucide en CDN avec `<i data-lucide="name">`. En Vue, on utilise `lucide-vue-next` :

```vue
<script setup lang="ts">
import { Mail, Lock, ChevronLeft, ArrowRight } from 'lucide-vue-next'
</script>

<template>
  <button class="btn btn-primary">
    Continuer <ArrowRight :size="14" />
  </button>
</template>
```

Tailles standards : 12, 14, 16 (défaut), 18, 20, 24, 32. **stroke-width 2** (default).

## 6. Architecture en couches — RAPPEL

Comme dans `apps/web`, jamais de Firebase SDK dans un composant Vue :

```
views/  →  composables  →  stores (Pinia)  →  repositories  →  Firebase SDK
```

Quand on convertit un écran qui appelle "submit", le composant appelle un **store** (`auth`, `registrations`, etc.), pas une callable. Le store appelle un **repo**, le repo importe le SDK.

Pour le wizard (E5–E14), prévoir :
- `stores/registration.ts` → état partagé (current step, form data, draft autosave).
- `repositories/registrations.repo.ts` → write `/registrations/{id}` doc + Storage uploads.
- `services/cloudFunctions.ts` → wrappers pour `matchExistingMember`, `submitRegistration` (callables côté Functions).

Cf. `docs/chantier-registrations.md` §10–12 pour les contrats exacts.

## 7. Doublons attendus avec `apps/web`

Le bundle `Courtbase Mockups.html` (app admin, **déjà implémenté côté `apps/web`**) partage des **types** et des **briques visuelles** avec le bundle register :

| Concept | apps/web (admin) | apps/courtbase-register (parents) |
|---|---|---|
| `Team` typedef | `packages/shared-types/src/team.ts` | importé via `@club-app/shared-types` |
| Statut équipe (Open/Conditional/Closed) | pill `.pill-emerald|amber|slate` | **mêmes pills** (atoms partagés) |
| Coach card | côté admin (member detail) | côté parent (E9, E10) — pas de composant partagé, copier le markup |
| Stepper wizard | onboarding club | wizard inscription — atom partagé via style.css |
| Schéma `Registration` | écrit par admin (review) | écrit par parent (création) — même type, **règles Firestore** différentes |

**Règle** : pas de partage de composants Vue entre les deux apps (interdit par `CLAUDE.md` racine). Partage **uniquement** via `packages/shared-types/` et la grammaire visuelle (atoms CSS répliqués des deux côtés).

## 8. Checklist quand tu convertis un nouvel écran

- [ ] Localiser le `<template id="tpl-eN">` dans le HTML du bundle.
- [ ] Identifier les atoms utilisés — vérifier qu'ils sont tous dans `style.css`. Si manquant, l'ajouter **dans le même PR** que le composant.
- [ ] Vérifier que les atomes CSS utilisés (`.choice-card`, `.team-card`, `.doc-tile`, `.banner-*`, etc.) sont déjà dans `style.css`. **Si un atome manque, l'ajouter dans le même PR que le composant** (ne pas dupliquer dans un scoped style).
- [ ] Pour les composants v-model double (cas de `RelationshipPicker`), utiliser `defineProps<{ relationship: ..., relationshipOther: ... }>()` + `defineEmits<{ (e: 'update:relationship', ...): void; (e: 'update:relationshipOther', ...): void }>()` — **pas** de `defineModel()` (incompat avec scoped styles dans certaines configs Vite + scoped styles).
- [ ] Pour les bottom-sheets (`.modal-overlay` + `.modal-sheet`), préférer le markup natif des atoms `style.css` plutôt que `<Drawer position="bottom">` PrimeVue — plus de contrôle sur le z-index et l'animation. Cas concret : `MatchFoundDialog.vue`.
- [ ] Identifier l'écran dans `docs/chantier-registrations.md` pour les règles métier (validations, états, callables).
- [ ] Créer la route + le fichier Vue (`views/...` ou `components/...` selon le cas).
- [ ] Câbler sur le bon store. **Jamais** d'appel direct au SDK Firebase.
- [ ] Reproduire le markup en gardant les classes Tailwind/atoms du prototype.
- [ ] Remplacer les `<i data-lucide>` par les imports `lucide-vue-next`.
- [ ] Remplacer les boutons et inputs simples par PrimeVue où ça reste cohérent.
- [ ] Vérifier que `npm run type-check -w @club-app/courtbase-register` passe.
- [ ] Vérifier le rendu à 375px (Chromium devtools mobile mode).

## 9. À ne PAS faire

- Ne pas copier le bezel iPhone, le nav rail, l'inspector rail, le viewport toggle, ni le script de navigation `goto` — ce sont des outils de présentation du prototype.
- Ne pas inliner Tailwind CDN ni Lucide CDN dans `index.html` — tout passe par le build Vite.
- Ne pas créer de couche "design system" séparée (`packages/design-system/`) tant que `apps/web` et `apps/courtbase-register` ne partagent que les atoms basiques (ils divergent vite — admin desktop vs. parent mobile-first).
- Ne pas implémenter le wizard step-by-step **avant** d'avoir le store de registration et les callables (sinon on devra tout réécrire pour câbler le state).
- Ne pas reproduire pixel-perfect les écrans qui mockent du contenu (E4 mocke 5 statuts simultanés — c'est pour la review design, pas pour la prod ; en prod, on rend ce qui vient du store).
- Ne pas appeler le SDK Firebase ni `services/cloudFunctions.ts` directement depuis une vue ou un composant — toujours passer par un store Pinia.
- Ne pas lire `auth.hasProfile` ou `auth.userDoc` immédiatement après `await auth.signInWithGoogle()` — utiliser les wrappers du store qui attendent la résolution complète du userDoc (cf. §10).

## 10. Leçons Phase C (livrée 2026-05-14)

Cette section capitalise les surprises rencontrées pendant la conversion des 9 vues du wizard. À garder en tête pour les phases D et E.

### Tri en JS plutôt que `orderBy` Firestore

Pour les listes attendues à moins de 100 docs (`listMyRegistrations`, `listEligibleTeams`), retirer le `orderBy` Firestore et trier en JS dans le repo ou le store. Avantages :

- Pas d'index composite à déployer.
- Tolère les `serverTimestamp` non résolus (un draft fraîchement créé a `createdAt: null` côté client tant que le serveur n'a pas répondu — `orderBy('createdAt')` l'aurait jeté ; un tri JS le pousse en tête sans bug).

Exemple :

```ts
const teams = (await getDocs(query(collection(db, 'teams'), where('registrationOpen', '==', true)))).docs
  .map(d => ({ id: d.id, ...d.data() } as PublicTeam))
  .sort((a, b) => {
    const order = { open: 0, conditional: 1, closed: 2 } as const
    return order[a.registrationStatus] - order[b.registrationStatus]
  })
```

### Race condition OAuth — `signInWithPopup` retourne avant `onAuthStateChanged`

`signInWithPopup` résout la promesse avant que `onAuthStateChanged` n'ait fini de propager l'utilisateur courant et que le `userDoc` Firestore n'ait été chargé. Si une vue lit `auth.hasProfile` ou `auth.userDoc` immédiatement après le `await`, elle voit `null` et redirige à tort vers le setup.

Pattern à utiliser dans `stores/auth.ts` :

```ts
async function runSignIn() {
  resolvingProfile.value = true
  try {
    await signInWithPopup(getAuth(), googleProvider)
    await waitForUserDocResolution() // wrapper qui await la fin de loadUserDoc()
  } finally {
    resolvingProfile.value = false
  }
}
```

Les vues qui dépendent de `hasProfile` doivent attendre que `resolvingProfile === false` avant de router.

### Conversion `Timestamp` neutre côté client

Le type `Timestamp` exporté par `@club-app/shared-types` est **`{ seconds: number, nanoseconds: number }`** (un POJO neutre), pas la classe `firebase.firestore.Timestamp`. Conversion en `Date` JS :

```ts
function tsToDate(ts: { seconds: number } | null | undefined): Date | null {
  if (!ts) return null
  return new Date(ts.seconds * 1000)
}

function dateToTs(d: Date): { seconds: number; nanoseconds: number } {
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }
}
```

Si le Timestamp est en pending `serverTimestamp` (donc `null`) sur un draft fraîchement créé, gérer le fallback (afficher "à l'instant" ou la date locale courante). Helper utilisé dans `Step3TeamPicker` (lit `birthDate`) et `Step7LicenseInfo` (affiche `createdAt`).

### Cancel callable interdit sur drafts — utiliser `deleteDoc` direct

La callable `cancelRegistration` ne fonctionne que sur les registrations en statut `submitted` ou supérieur (elle gère la notification au coach, le refund éventuel, etc.). Pour supprimer un brouillon `draft`, passer par `deleteDoc` direct :

```ts
async function removeDraft(id: string) {
  await deleteDoc(doc(db, 'registrations', id))
  // store update local
  delete byId.value[id]
  if (currentDraftId.value === id) clearDraft()
}
```

Les rules Firestore autorisent `delete` par l'auteur si `status === 'draft'` (cf. `docs/firebase.md`). Wrappé dans `useRegistrationsStore().removeDraft(id)` et appelé depuis l'icône poubelle des cards Home.
