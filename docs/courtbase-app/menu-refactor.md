# Refactor — Menu unifié single-page (courtbase-app)

> **État** : brief posé 2026-05-24. Implémentation à venir (4 PR / agents parallèles).
> **Cible** : `apps/courtbase-app` uniquement (PWA mobile-first companion).

## Intention

Le `Home.vue` actuel (~1500 lignes) duplique 5 variants quasi-identiques :
- `HomeDesktop` (≥ 1024px)
- `HomeMultiRoleMobile` (mobile + role switcher)
- `HomeCoachMobile` / `HomeOfficialMobile` / `HomeAdminMobile`

Ce design impose :
- **Duplication massive** : chaque section coach existe 3× (desktop, multi-role, coach-only).
- **Charge data non-scopée** : on charge tout pour tout le monde, le rendering filtre après.
- **Role switcher pour multi-role** : artificiel — un user `coach + admin` ne devrait pas devoir basculer, il devrait voir les 2 univers ensemble.

**Cible** : **un seul template Home**, **sections conditionnelles** par rôle, **un seul jeu de nav items** filtré côté composable. Chaque section ne charge ses données que si l'utilisateur a le rôle correspondant.

## Principe single-page

- **Home = hub unique**, structuré en sections empilées (Coach / Officiel / Admin / Joueur dans cet ordre fixe).
- Pas de duplication entre mobile / desktop : un seul template responsive (Tailwind / CSS classes), pas de `v-if="isDesktop"` qui swap des sous-arbres entiers. Le shell (`CbMobileShell` vs `CbDesktopShell`) reste responsive, **mais le contenu interne est unique**.
- Pas de role switcher. Multi-role = empilement direct des sections autorisées.
- Une section = un titre (`<CbSectionHeader>`) + cards/actions/listes propres à ce rôle.
- Chargement lazy : `onMounted` de chaque sous-composant section ne fait son fetch que si l'auth confirme le rôle.

## Architecture cible

### Composants nouveaux

- `src/components/home/HomeCoachSection.vue` — bloc coach (équipes, registrations à traiter, licence reviews, exclusions cotisation, planning court terme).
- `src/components/home/HomeOfficialSection.vue` — bloc officiel (assignations en cours, matchs ouverts à mon niveau, no-license banner).
- `src/components/home/HomeAdminSection.vue` — bloc admin (broadcast, requests pending, staffing court terme).
- `src/components/home/HomePlayerSection.vue` — bloc joueur (mes matchs, mes cotisations).
- `src/components/home/HomeEmpty.vue` — fallback quand `auth.roles.length === 0` (situation théorique post-acceptInvitation qui n'a pas posé de rôle).

Chaque section :
- Reçoit aucune prop (ou minimal — `auth` lu directement via store).
- Est responsable de son propre `onMounted` (fetch scopé au rôle).
- Émet aucun event vers le parent — navigation = `router.push` interne.

### Home.vue final (≤ 150 lignes)

```vue
<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useViewport } from '@/composables/useViewport'
import { useShellNav } from '@/composables/useShellNav'

import CbMobileShell from '@/components/ui/CbMobileShell.vue'
import CbDesktopShell from '@/components/ui/CbDesktopShell.vue'
import HomeCoachSection from '@/components/home/HomeCoachSection.vue'
import HomeOfficialSection from '@/components/home/HomeOfficialSection.vue'
import HomeAdminSection from '@/components/home/HomeAdminSection.vue'
import HomePlayerSection from '@/components/home/HomePlayerSection.vue'
import HomeEmpty from '@/components/home/HomeEmpty.vue'

const auth = useAuthStore()
const { isDesktop } = useViewport()
const { tabs, nav, primaryRoleLabel } = useShellNav()

const hasAnyRole = computed(
  () => auth.isCoach || auth.isOfficial || auth.isAdmin || auth.isPlayer,
)
</script>

<template>
  <component
    :is="isDesktop ? CbDesktopShell : CbMobileShell"
    title="Accueil"
    :tabs="tabs"
    :nav="nav"
    :user-role="primaryRoleLabel"
  >
    <main class="space-y-6 p-4">
      <HomeEmpty v-if="!hasAnyRole" />
      <HomeCoachSection v-if="auth.isCoach" />
      <HomeOfficialSection v-if="auth.isOfficial" />
      <HomeAdminSection v-if="auth.isAdmin" />
      <HomePlayerSection v-if="auth.isPlayer" />
    </main>
  </component>
</template>
```

Le shell mobile vs desktop reste un swap au top-level, mais **le contenu (les sections) est identique** entre les deux.

### useShellNav refactor

Aujourd'hui : retourne 9 collections (`coachTabs`, `officialTabs`, `adminTabs`, `playerTabs`, `multiRoleTabs`, `coachNav`, `officialNav`, `adminNav`, `playerNav`).

Cible : retourne **3 valeurs** :
- `tabs: ComputedRef<CbTab[]>` — tab bar mobile, dérivée des rôles user. Max 4 items, sélection règlée par priorité (cf. §"Sélection tabs mobile" ci-dessous).
- `nav: ComputedRef<CbNavItemGroup[]>` — sidebar desktop, **groupée par rôle** (un group par rôle utilisateur, avec titre).
- `primaryRoleLabel: ComputedRef<string>` — label "Coach" / "Officiel" / "Admin" / "Joueur" pour l'avatar du shell (rôle prioritaire). Si multi-role, prend le plus "actionnable" selon priority list.

Le composant `CbSidebar` doit accepter une structure groupée :

```ts
interface CbNavItemGroup {
  /** Label de section : "Coach", "Officiel", "Admin", "Joueur". */
  label: string
  items: CbNavItem[]
}
```

Pour rétro-compat, accepter aussi `CbNavItem[]` plat (fallback : un seul groupe sans titre).

### Sélection tabs mobile (max 4)

Tab bar = 4 slots. Avec multi-role, on doit choisir. Règle :

1. **Slot 1** : Home (toujours).
2. **Slot 2-4** : 1 onglet par rôle ACTIF de l'utilisateur, dans l'ordre Coach > Officiel > Admin > Joueur, **l'onglet le plus représentatif** du rôle.
   - Coach → "Équipes" (`team`)
   - Officiel → "Mes assignations" (`my-assignments`)
   - Admin → "Staffing" (`staffing`)
   - Joueur → "Mes matchs" (`player-matches`, si la route existe sinon `agenda`)

3. **Si l'utilisateur a > 3 rôles** (coach + officiel + admin) → slot 4 devient "Plus" qui ouvre une sheet avec le 4e rôle + Notifications + Profil. À itérer si besoin.

Le composant `CbTabBar` reste inchangé côté API — on lui passe juste les bons items.

### Sidebar desktop — grouping

`CbSidebar` accepte `CbNavItemGroup[]`. Render :

```
┌──────────────────┐
│  Logo Courtbase  │
├──────────────────┤
│ Accueil          │
│                  │
│ COACH            │  ← group label, uppercase 11px, surface-500
│ • Équipes        │
│ • Agenda         │
│ • Inscriptions   │
│ • Reviews lic.   │
│                  │
│ OFFICIEL         │
│ • Mes assign.    │
│ • Matchs ouverts │
│                  │
│ ADMIN            │
│ • Staffing       │
│ • Requests       │
│ • Broadcast      │
├──────────────────┤
│ Notifications    │
│ 👤 Mon compte    │
└──────────────────┘
```

Un user single-role voit un seul groupe (sans label si un seul groupe ? À décider — préférer toujours le label pour cohérence visuelle).

## Routing / allowlist

- `router/allowlist.ts` reste **inchangé** dans son principe (deny-by-default par rôle).
- Une route `'player-matches'` peut être ajoutée si elle n'existe pas, scopée au rôle `player`.
- Pas de nouvelle route home/section — toutes restent les mêmes (chaque section navigue vers les routes existantes).

## Data loading scope

Aujourd'hui, `Home.vue` charge `teamsStore.loadForCoach` + `licenseRequestsStore.loadPendingReviewForCoach` même pour un user qui n'est ni coach ni admin. Cible :

- **`HomeCoachSection.vue`** charge `teamsStore.loadForCoach` + `licenseRequestsStore.loadPendingReviewForCoach` dans son `onMounted`.
- **`HomeOfficialSection.vue`** charge `assignmentsStore.loadForOfficial` (à créer si pas existant — sinon utilise le repo mock).
- **`HomeAdminSection.vue`** charge `requestsStore.loadPending` + `staffingStore.loadUpcoming`.
- **`HomePlayerSection.vue`** charge `myMatchesStore.load` (mock-based pour MVP, brancher Firestore plus tard).

Chaque section est isolée — si l'user n'a pas le rôle, la section n'est pas rendue, donc aucun fetch ne se déclenche.

**Idempotence obligatoire** : si un store est déjà chargé (cache hit), le `load` revient sans re-fetch (pattern déjà appliqué — `if (store.teams.length === 0) load()`).

## Migration des données dérivées actuelles

`Home.vue` actuel a beaucoup de `computed` (registrationsToTreatCount, excludedMembersCount, openMatchesForLevel, myAssignments, etc.). À distribuer dans les bonnes sections :

| Computed actuel | Migre vers |
|---|---|
| `coachTeams` | `HomeCoachSection` |
| `registrationsToTreatCount` | `HomeCoachSection` |
| `excludedMembersCount` | `HomeCoachSection` |
| `licenseReviewsCount` | `HomeCoachSection` |
| `openMatchesForLevel` | `HomeOfficialSection` |
| `myAssignments` | `HomeOfficialSection` |
| `licenseRequestsCount` (admin requests) | `HomeAdminSection` |
| `paymentExceptionRequestsCount` | `HomeAdminSection` |
| `matchMoveRequestsCount` | `HomeAdminSection` |

## PR breakdown (4 agents parallèles)

| PR | Scope | Fichiers principaux |
|---|---|---|
| **PR-M-A** | useShellNav refactor + `CbNavItemGroup` + `CbSidebar` groupé + sélection tabs mobile | `composables/useShellNav.ts`, `components/ui/CbSidebar.vue`, `components/ui/CbTabBar.vue`, `types/roles.ts` éventuellement |
| **PR-M-B** | 4 sections + HomeEmpty | `components/home/HomeCoachSection.vue`, `HomeOfficialSection.vue`, `HomeAdminSection.vue`, `HomePlayerSection.vue`, `HomeEmpty.vue` |
| **PR-M-C** | `Home.vue` réduit + intégration sections (consomme A + B) | `views/Home.vue` |
| **PR-M-D** | Docs + sync `apps/courtbase-app/CLAUDE.md` + retrait des références obsolètes | `apps/courtbase-app/CLAUDE.md`, `docs/courtbase-app.md` si pertinent |

### Dépendances

- PR-M-A et PR-M-B peuvent commencer en parallèle (B utilise des stores existants ou crée des sections mock-only — pas de dépendance sur A).
- PR-M-C dépend de A et B (intègre les 2). Lance après leurs merge.
- PR-M-D peut commencer en parallèle (purement docs).

Pour accélérer : **lancer A + B + D en parallèle, puis C une fois A et B finis**.

## Garde-fous

- **Pas de modif backend** (callables, rules, shared-types).
- **Pas de modif router/index.ts** sauf ajout potentiel d'une route `player-matches` (à valider avant ajout — peut être différé).
- **Préserver mode hybride mock + Firestore réel** : les sections coach/official restent compatibles avec les 2 modes (cf. patterns existants `licenseRequests`, `teams`).
- **Architecture en couches stricte** : composants → composables → stores → repositories. Pas de Firestore direct dans les sections.
- **Pas de toast global** (cohérent avec décisions Tier 1).
- **Test manuel obligatoire** :
  - User `coach` seul → voit uniquement section Coach + tabs coach.
  - User `coach + official` → voit les 2 sections empilées + tab "Plus" si > 3 rôles ?.
  - User `admin` seul → voit section Admin.
  - User sans rôle (`roles=[]`) → voit `HomeEmpty`.
  - Desktop ≥ 1024px → sidebar groupée, sections empilées dans main.
  - Mobile → tab bar 4 items + sections empilées scrollables.

## Pas dans le scope

- Refonte visuelle des sections (les contenus actuels sont préservés).
- Ajout de nouvelles features par rôle (ex. nouveau widget admin) — c'est juste un re-layout.
- Refactor des autres vues (`TeamRoster`, `MemberDetail`, etc.) — uniquement Home + nav.
- PWA / FCM / offline.

## Références

- `apps/courtbase-app/src/views/Home.vue` — vue actuelle (~1500 lignes, cible de réduction)
- `apps/courtbase-app/src/composables/useShellNav.ts` — composable actuel à refactor
- `apps/courtbase-app/src/components/ui/CbSidebar.vue` — sidebar desktop
- `apps/courtbase-app/src/components/ui/CbTabBar.vue` — tab bar mobile
- `apps/courtbase-app/src/router/allowlist.ts` — allowlist par rôle (inchangé)
- `apps/courtbase-app/CLAUDE.md` — conventions stack
- `docs/courtbase-app.md` — spec produit
- `docs/design-brief-courtbase-app.md` — design system + écrans
