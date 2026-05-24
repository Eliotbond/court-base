# Intégration Basketplan — brief technique

> Brief de référence pour l'intégration des données fédérales Basketplan (Swiss Basketball / ORCA Systems) dans court-base. Rédigé pour pouvoir reprendre le chantier à froid plusieurs semaines après la rédaction. Le plan d'exécution en PRs est dans `docs/chantier-basketplan.md`.

## 1. Objectif

Permettre à un club court-base (Marly aujourd'hui, autres demain) de lier chacune de ses équipes à **N compétitions Basketplan** (championnats + coupes, potentiellement dans plusieurs fédérations en parallèle), puis d'ingérer automatiquement les matchs officiels dans `/matches` court-base — avec leurs résultats, arbitres fédéraux et lieu.

But final : **plus de double saisie** des matchs officiels, et un dossier `/matches` qui reflète la réalité fédérale en temps quasi-réel (sync nocturne).

## 2. Contexte

### 2.1 Basketplan en bref

Plateforme officielle Swiss Basketball (éditeur ORCA Systems). Toutes les pages publiques HTML sont disponibles en **XML** en ajoutant `&xmlView=true&perspective=default` à l'URL — aucune authentification requise, données rafraîchies "on the fly".

Endpoints retenus pour le chantier (tous testés OK en mai 2026) :

| Endpoint | Usage |
|----------|-------|
| `findAllLeagueHoldings.do?federationId=X` | Liste des ligues d'une fédération (saison en cours + précédentes). |
| `showLeagueSchedule.do?leagueHoldingId=Y` | Calendrier complet d'une ligue — endpoint principal du sync. Contient `<game>` avec `gameNumber`, `<homeTeam id="…" clubId="…" name="…">`, `<guestTeam>`, `<result>` (score par quart + total), `<state>` (`homologué`, `pas joué`…), `<location>`, `<referee1Name>`, `<referee2Name>`, `<expertName>`. |
| `showRankingForLeague.do?leagueHoldingId=Y` | Classement live (V/D, pts pour/contre, position, places relegation). |
| `searchGames.do?clubId=…&federationId=…&from=DD.MM.YY&to=DD.MM.YY` | Recherche transverse — utile pour diagnostic, pas pour le sync principal (le `leagueHoldingId` donne déjà tout). |
| `findTeamById.do?teamId=Z&clubId=…&federationId=…` | Détail d'une équipe : club, catégorie, fonctionnaires (coachs, responsables). |

Endpoints **inaccessibles** sans login (ne pas s'appuyer dessus) : `searchTeams.do`, `showGame.do?gameId=…`. Tout ce qu'on veut savoir d'un match est déjà dans `showLeagueSchedule`.

### 2.2 Identifiants Marly Basket

- `clubId = 60`, `federationId = 9` (AFBB, Association Fribourgeoise).
- Exemple senior masculin 2LM : `leagueHoldingId = 10584`, `teamIdInLeague = 6570`.
- Exemple U20 féminin : `teamId = 128`.

### 2.3 Fédérations Basketplan connues

Une `team` court-base peut être inscrite dans des compétitions de **plusieurs fédérations** (ex. U18 jouent en CSJC + Coupe AFBB ; U23F ont joué U23F national + 3LF cantonal).

| `federationId` | Code | Nom |
|----------------|------|-----|
| 1 | BVN | Nord-Ouest (Bâle) |
| 5 | ACGBA | Genève |
| 9 | AFBB | Fribourg |

**À compléter à l'exécution** : CSJC, ACNBA (Neuchâtel), Vaud, Valais, Tessin, Berne, et fédérations nationales Swiss Basketball (NLB, etc.). Méthode : appeler `findAllLeagueHoldings.do?federationId=N` pour `N` de 1 à 30 et noter ce qui répond.

### 2.4 État court-base aujourd'hui

- `MatchData` (`packages/shared-types/src/match.ts`) : `kind: 'home' | 'away'`, `teamId`, `matchTypeId`, `opponentName`, `date`, `startTime`, `endTime`, `status: 'scheduled' | 'cancelled' | 'played'`. **Aucun** champ externe / fédéral.
- Création manuelle uniquement via :
  - Admin web : `apps/web/src/components/matches/MatchFormDialog.vue` (HOME via picker booking, AWAY via formulaire date+adresse).
  - Coach mobile/PWA : callable `coachCreateAwayMatch` (AWAY seul, scope coach-of-team).
- HOME = atomique avec un booking (`bookingId` non null, `writeBatch`). AWAY = `bookingId: null`.
- `team.basketplanLinks` n'existe pas, `match.externalSource` non plus.
- `firestore.rules` : `/matches` et `/teams` en write admin-only ; les écritures coach passent par callables.
- Functions région : `europe-west6` (Zurich). Pas de dépendance `fetch`/`xml-parser` dans `functions/package.json`.

## 3. Scope

### 3.1 In-scope

1. **Mapping** : permettre à admin + coachs de lier une équipe court-base à N compétitions Basketplan via cascade 3-étapes (fédération → ligue → équipe).
2. **Sync auto** (cron nuit) :
   - Création automatique des matchs **AWAY** dans `/matches` (le club ne porte pas le créneau).
   - Backfill des **scores** + **arbitres fédéraux** + **lieu** sur les matchs existants (HOME et AWAY) matchés par `gameNumber` ou date+adversaire.
   - Création des matchs **HOME** quand un timeSlot/court correspond ; sinon inbox admin à valider.
3. **Affichage** : badge "Basketplan" + arbitres + score officiel dans `Matches.vue` (web) et `MatchDetail` (courtbase-app coach + officiel).
4. **Settings global** : `/config/club.basketplan = { clubId, defaultFederationId, enabled, lastSyncAt }`.

### 3.2 Out-of-scope (reportable)

- Publication **vers** Basketplan (API read-only, impossible).
- Widget classement live sur fiche team (bonus, reportable).
- Auto-mapping team par nom (jugé fragile, on garde le cascade explicite).
- Notification push parents/joueurs avec arbitres.
- Liaison arbitres fédéraux Basketplan ↔ `/members` court-base.
- Mode "offline" : si Basketplan tombe, on log et on retente la nuit suivante.

## 4. Architecture data

### 4.1 `packages/shared-types/src/team.ts`

```ts
export interface BasketplanCompetitionLink {
  id: string                  // uuid local, généré côté Function
  federationId: number        // 9
  federationCode: string      // "AFBB" (cache pour affichage rapide)
  leagueHoldingId: number     // 10583
  leagueHoldingName: string   // "3LM - Saison 25/26 - Phase préliminaire" (cache)
  season: string              // "25/26" (extrait de leagueHoldingName)
  teamIdInLeague: number      // 6570 (id Basketplan de l'équipe DANS cette ligue)
  teamNameInLeague: string    // "Marly Basket" (cache)
  active: boolean             // pause sans suppression
  addedAt: Timestamp
  addedBy: string             // uid (admin ou coach)
}

export interface TeamData {
  // ...existant
  basketplanLinks?: BasketplanCompetitionLink[]   // [] ou absent si jamais lié
}
```

### 4.2 `packages/shared-types/src/match.ts`

```ts
export interface MatchData {
  // ...existant
  externalSource?: 'basketplan' | null
  externalGameNumber?: string | null            // "25-08231" — clé unique
  externalLeagueHoldingId?: number | null
  externalReferees?: {
    referee1?: string | null
    referee2?: string | null
    expert?: string | null
  } | null
  externalResult?: {
    homeScore: number
    awayScore: number
    homologated: boolean
    byQuarter?: Array<{ home: number; away: number }>
  } | null
  externalLastSyncedAt?: Timestamp | null
}
```

### 4.3 `packages/shared-types/src/config.ts`

```ts
export interface ClubConfig {
  // ...existant
  basketplan?: {
    clubId: number              // 60 pour Marly
    defaultFederationId: number // 9 pour AFBB
    enabled: boolean
    lastSyncAt?: Timestamp | null
    lastSyncError?: string | null  // message en clair si dernier sync KO
  }
}
```

### 4.4 Collection `/basketplanInbox/{id}` (nouvelle)

Quand le sync trouve un match HOME Basketplan mais n'arrive pas à le matcher à un booking court-base existant ni à créer le booking automatiquement, il crée un doc dans cette inbox pour validation admin.

```ts
export interface BasketplanInboxItem {
  source: 'basketplan'
  teamId: string                  // team court-base concernée
  link: BasketplanCompetitionLink // sous lequel le match a été découvert
  game: {
    gameNumber: string
    date: Timestamp
    startTime: string
    location: string              // "Grand-Pré 3"
    opponentName: string
    referees: { referee1?: string; referee2?: string; expert?: string }
  }
  reason: 'no_court_match' | 'court_busy' | 'venue_unknown'
  createdAt: Timestamp
  resolvedAt?: Timestamp | null
  resolvedBy?: string | null
  resolvedAction?: 'created' | 'ignored' | 'manual_link'
  resultingMatchId?: string | null
}
```

### 4.5 Rules & indexes

- `firestore.rules` :
  - `/basketplanInbox/{id}` : read+write **admin uniquement**.
  - `/teams/{teamId}` reste admin-only ; les modifications de `basketplanLinks` passent par les callables (Admin SDK).
- `firestore.indexes.json` :
  - Single-field auto sur `match.externalGameNumber` suffit (query `where('externalGameNumber', '==', X) limit 1`).
  - Aucune autre composite à ajouter (les loops scannent par `teamId`).

## 5. Architecture services (Cloud Functions)

Nouveau dossier `functions/src/basketplan/`.

### 5.1 Helpers communs

- `_client.ts` : `fetchBasketplanXml(url)` → `string` brut + parse via `fast-xml-parser` (à ajouter à `functions/package.json`).
- `_parsers.ts` : `parseLeagueHoldings`, `parseLeagueSchedule`, `parseRanking` — type-safe (renvoient des `LeagueHolding[]`, `Game[]`, `RankingRow[]`).
- `_sync.ts` : algorithme central par équipe (cf. § 5.3).
- `_authz.ts` : helper `assertAdminOrCoachOfTeam(uid, teamId)` (reprend le pattern de `coachCreateAwayMatch`).
- Pattern try/catch obligatoire avec capture `code` (cf. `CLAUDE.md` racine, règle 9).

### 5.2 Callables (toutes en `europe-west6`)

| Function | Scope | Rôle |
|----------|-------|------|
| `listBasketplanLeagueHoldings({ federationId })` | signed-in | Fetch + parse + cache 1h en mémoire. Retourne `LeagueHolding[]` filtré sur les 2 dernières saisons. |
| `listClubTeamsInLeague({ leagueHoldingId })` | signed-in | Fetch `showLeagueSchedule`, extrait équipes du `config.club.basketplan.clubId` (dédupliquées). |
| `linkTeamToBasketplan({ teamId, federationId, leagueHoldingId, teamIdInLeague })` | admin OR coach-of-team | Ajoute un `BasketplanCompetitionLink` (résout les noms cache côté serveur, `id` uuid). |
| `unlinkTeamBasketplan({ teamId, linkId })` | admin OR coach-of-team | Retire le lien. |
| `toggleTeamBasketplanLink({ teamId, linkId, active })` | admin OR coach-of-team | Active/désactive sans supprimer. |
| `syncBasketplanForTeam({ teamId })` | admin OR coach-of-team | Sync à la demande (debug + bouton "Synchroniser maintenant"). |
| `testBasketplanConnection({})` | admin | Ping `findAllLeagueHoldings.do?federationId=<defaultFederationId>` pour diagnostic Settings. |

### 5.3 Scheduled `scheduledBasketplanSync`

**Statut PR 2 (livré 2026-05-24)** : la callable `syncBasketplanForTeam` + le scheduled `scheduledBasketplanSync` sont implémentés, **scope AWAY + backfill uniquement**. Le cas HOME (`weAreHome` dans `applyGame`) renvoie `{ action: 'skipped-home', reason: 'home-creation-deferred-to-pr3' }` — la création automatique de bookings HOME + Inbox admin est différée en PR 3 (cf. checklist `docs/chantier-basketplan.md`).

Les champs `match.external*` (`externalSource`, `externalGameNumber`, `externalLeagueHoldingId`, `externalReferees`, `externalResult`, `externalLastSyncedAt`) sont posés/maintenus par les passes du sync. Voir `docs/firebase.md` § `/matches/{matchId}` pour le détail des champs et la description de l'algorithme `applyGame`.

- Trigger : `onSchedule({ schedule: '0 3 * * *', timeZone: 'Europe/Zurich', region: 'europe-west6' })`.
- Algo :
  ```
  Si !config.club.basketplan?.enabled → return
  teams = query /teams where basketplanLinks != null
  Pour chaque team :
    Pour chaque link actif (try/catch indépendant par link) :
      games = parseLeagueSchedule(fetch showLeagueSchedule.do?leagueHoldingId=link.leagueHoldingId)
      myGames = games.filter(g => g.homeTeamId === link.teamIdInLeague
                                || g.guestTeamId === link.teamIdInLeague)
      Pour chaque g de myGames : applyGame(team, link, g)
    update team.lastBasketplanSyncAt (sub-field)
  update config.club.basketplan.lastSyncAt
  ```
- `applyGame` (cœur du sync) :
  ```
  existing = /matches where externalGameNumber == g.gameNumber LIMIT 1
  Si existing :
    patch externalReferees, externalResult, externalLastSyncedAt
    Si g.state === 'homologué' et existing.status !== 'played' :
      patch status = 'played'
    return
  // Pas d'existing → tentative de matching avec match manuel
  manual = /matches where teamId == team.id
                       AND date in [g.date - 24h, g.date + 24h]
                       AND opponentName fuzzy ≈ otherTeam.name (Levenshtein < 3)
  Si manual :
    patch manual.externalGameNumber, externalLeagueHoldingId, externalReferees, externalResult, externalSource
    return
  // Création neuve
  Si g.guestTeamId === link.teamIdInLeague :   // AWAY
    create /matches { kind:'away', bookingId:null, teamId:team.id,
                      matchTypeId: <résolu depuis link.federationCode + link.leagueHoldingName>,
                      opponentName: g.homeTeam.name, awayAddress: g.location,
                      date: g.date, startTime: g.time, endTime: g.time + 2h,
                      status: 'scheduled', notes: null, createdBy: 'system:basketplan',
                      externalSource:'basketplan', externalGameNumber, externalLeagueHoldingId,
                      externalReferees, externalLastSyncedAt }
  Sinon (HOME) :
    Essai création booking :
      court = lookup /venues + courts par fuzzy match de g.location
      Si court trouvé et timeSlot dispo at g.date+time :
        writeBatch { create booking match_home, create match HOME atomique }
      Sinon :
        create /basketplanInbox { reason: 'no_court_match' ou 'court_busy' ou 'venue_unknown', game, link, teamId }
  ```
- Mapping `matchTypeId` : ajouter une table de résolution simple `federationCode + leagueHoldingName patterns → matchTypeId`, configurable dans `/config/club.basketplan.matchTypeMapping?`. Fallback : créer un `matchType` "Championnat (Basketplan)" générique au first run et l'utiliser par défaut.

### 5.4 Dépendances Functions

À ajouter à `functions/package.json` :
- `fast-xml-parser` (parsing XML léger, déjà très utilisé Node-side).
- Pas besoin de `node-fetch` : `fetch` est natif sur Node ≥ 18 (Functions v2 sur Node 20 par défaut).

### 5.5 Déploiement

Standards à appliquer (déjà documentés en memory) :
- `npm run build` puis `firebase deploy --only functions:basketplan-*` (groupe par nom).
- Tarball `shared-types` (cf. memory `deploy_functions_monorepo_fix`).
- Après déploiement, pour chaque nouvelle callable v2 : `gcloud run services add-iam-policy-binding <name> --member=allUsers --role=roles/run.invoker --region=europe-west6` (cf. memory `deploy_functions_v2_invoker_binding`).
- Déploiement rules : `firebase deploy --only firestore:rules,firestore:indexes` (cf. memory `deploy_firestore_rules_required`).

## 6. Architecture UI

### 6.1 Settings — Intégration Basketplan

Nouveau : `apps/web/src/views/Settings/IntegrationsBasketplan.vue` (s'intègre au router Settings split déjà mergé `feat/settings-split`).

Contenu :
- Switch `enabled`.
- Inputs `clubId` (number), `defaultFederationId` (select des fédérations connues + champ "Autre ID" pour les nouvelles).
- Bouton "Tester la connexion" → appelle `testBasketplanConnection`, affiche `<ok>` ou message d'erreur du dernier ping.
- Affichage `lastSyncAt` formaté + `lastSyncError` si présent.
- CTA "Lancer la synchro maintenant" (boucle interne sur toutes les teams avec liens, admin only).

### 6.2 Fiche équipe — Section "Compétitions Basketplan"

À ajouter dans la vue Detail Team existante (ou à créer `apps/web/src/views/TeamDetail.vue` si absente — à vérifier en exécution).

Maquette :
```
─── Compétitions Basketplan ───────────────────
  AFBB  3LM - Saison 25/26 - Phase préliminaire    [ON ]  ×
        Équipe : Marly Basket
  AFBB  Coupe Senior M - Saison 25/26              [ON ]  ×
        Équipe : Marly Basket
  CSJC  U18 Men National - Saison 25/26            [OFF]  ×
        Équipe : Marly U18M

  [ + Lier une compétition ]
```

Dialog `apps/web/src/components/teams/BasketplanLinkDialog.vue` (cascade 3 étapes) :
```
┌─ Lier une compétition Basketplan ──────┐
│ Fédération                              │
│ [ AFBB - Fribourg               ▾ ]    │
│ Compétition (saison en cours)          │
│ [ Coupe U18 - Saison 25/26      ▾ ]    │
│ Équipe                                 │
│ ● Marly U18M                           │
│ ○ Marly U18M-2                         │
│ [Annuler]               [Lier →]       │
└────────────────────────────────────────┘
```
- Étape 1 : dropdown alimenté par liste statique `apps/web/src/lib/basketplan-federations.ts`.
- Étape 2 : appelle `listBasketplanLeagueHoldings({ federationId })` → tri par `season DESC, name`.
- Étape 3 : appelle `listClubTeamsInLeague({ leagueHoldingId })`.
- Validation : appelle `linkTeamToBasketplan({ teamId, federationId, leagueHoldingId, teamIdInLeague })`.

### 6.3 Courtbase-app (coach)

`apps/courtbase-app/src/views/coach/TeamCompetitions.vue` (nouveau) — même flow en mobile-first, BottomSheet pour le dialog. Accessible depuis l'écran CO5 "Planning équipe" via un bouton/onglet.

### 6.4 Affichage des matchs enrichis

`apps/web/src/views/Matches.vue` :
- Sur chaque ligne avec `externalSource === 'basketplan'` : pill "Basketplan #25-08231".
- Dans le drawer détail :
  - Section "Arbitres fédéraux" → `referee1`, `referee2`, `expert` (read-only).
  - Section "Résultat officiel" → `homeScore`/`awayScore`, badge "Homologué" si `homologated`, breakdown par quart-temps en tableau.
  - Si `externalSource` mais `externalResult === null` : pill "En attente d'homologation".

`apps/courtbase-app/src/views/coach/MatchDetail.vue` + `views/official/MatchDetail.vue` :
- Bandeau supérieur "Match officiel #25-08231 — AFBB 3LM".
- Section "Arbitres" (utile pour officiels internes qui marqueront la table, pour éviter chevauchement).
- Section "Résultat officiel" (si homologué).

### 6.5 Page admin "Basketplan Inbox"

`apps/web/src/views/BasketplanInbox.vue` (nouveau) :
- Liste des items non résolus.
- Pour chaque item : équipe, date, adversaire, lieu, raison, CTA "Créer le booking" (ouvre `MatchFormDialog` pré-rempli) ou "Ignorer".
- Visible uniquement pour admin (rules).
- Menu latéral : ajouter une entrée "Basketplan" (badge avec count non résolus).

## 7. Risques & questions ouvertes

1. **IDs des fédérations CSJC / ACNBA / SwissBasketball nationaux** : à inventorier en début de PR 1 (script de scan `for fed in 1..30`).
2. **Stabilité des `leagueHoldingId`** : changent à chaque saison (la doc Basketplan le mentionne explicitement). À la fin d'une saison, les liens deviennent "stale" — proposer en PR 1 un mécanisme de "renouveler les liens pour la saison suivante" (UI : bouton "Mettre à jour la saison" qui re-fetch et propose le mapping équivalent N+1).
3. **Format heures Basketplan** : à confirmer si tous les jeux ont bien `time` au format HH:MM (vu sur les exemples). Si certains XML omettent, default à 20:00 + log warning.
4. **Encoding XML** : Basketplan utilise UTF-8 avec accents bien gérés. Pas de prétraitement nécessaire mais valider en parsing.
5. **Rate limit** : la doc ne mentionne pas de quota. La sync nocturne fait au max ~50 fetchs (50 teams × 1 link moyen). Acceptable. Ajouter un `setTimeout 100ms` entre fetchs par précaution.
6. **Matching `matchType`** : choisir entre "matchType générique Basketplan" vs "mapping par pattern". Décider en début de PR 2 (pencher pour le générique en MVP).
7. **Coach scope sur create HOME auto** : un match créé par le sync l'est par `system:basketplan`, pas par un user. Vérifier que les hooks aval (staffing, notifications) ne plantent pas sur ce `createdBy`.
8. **Dédup match manuel ↔ Basketplan** : le fuzzy match (Levenshtein < 3 sur opponentName, ±24h sur date) peut faire des faux positifs (ex. "Bulle" vs "Bulle Basket"). Ajouter un attribut "merge confidence" dans les logs pour audit.

## 8. Vérification end-to-end (au moment de l'exécution)

1. Lancer `firebase emulators:start` avec un seed de teams Marly réelles et `/config/club.basketplan` rempli.
2. Tester la cascade en UI web Settings → Teams → lier "Seniors M" à 2LM 25/26 → vérifier le doc team mis à jour avec `basketplanLinks[0]`.
3. Déclencher `syncBasketplanForTeam(teamId)` manuellement → vérifier les `/matches` créés/maj.
4. Forcer un cas inbox (location inconnue) → vérifier item `/basketplanInbox`.
5. Tester scope coach : se connecter avec un uid coach-of-U18 et vérifier qu'on ne peut pas lier Seniors M.
6. Tester un Basketplan down (mock fetch en erreur) → vérifier que le log capture `lastSyncError` mais que les autres links continuent.

---

**Plan d'exécution** : voir `docs/chantier-basketplan.md`.
