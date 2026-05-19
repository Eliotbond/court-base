# Registrations — Overview produit

> Pourquoi cette app, acteurs/rôles, flow utilisateur global.
> Pour le détail Firestore : voir [`schema.md`](./schema.md). Pour le lifecycle des statuts : voir [`lifecycle.md`](./lifecycle.md). Pour les Cloud Functions : voir [`functions.md`](./functions.md). Pour le phasage : voir [`phases.md`](./phases.md).

## 1. Pourquoi cette app

L'app `web` est faite pour les **admins et coachs**. Les **parents et joueurs** n'ont aucun point d'entrée pour rejoindre le club : aujourd'hui, l'admin doit créer le membre manuellement depuis Settings. On veut un **portail public** dédié à l'inscription, déployé séparément, qui :

1. Permet à n'importe quel parent/joueur de **créer un compte** (Google, Apple, email).
2. Le guide à travers un **flow d'inscription** (pour soi, pour un enfant, ou pour un pupille).
3. Crée des `/registrations/{id}` que les **coachs et admins** voient dans l'app web pour valider / faire jouer / déclencher la licence.
4. Pilote ensuite, à distance, le **process licence fédérale** (upload pièces, signature formulaire) jusqu'à validation admin.

L'app vit **dans le même projet Firebase** que l'app web du club (modèle one-project-per-club inchangé) — mais c'est un **build et un hosting target distincts**. Voir la section "Hosting" plus bas pour le routage.

## 2. Acteurs et rôles

| Acteur | Identité Firebase | Scope |
|---|---|---|
| **Visiteur** | Pas de compte | Voit uniquement la landing + sign-up. |
| **User authentifié** (parent / joueur futur) | Firebase Auth, **pas** de `/users/{uid}` côté club | Complète son profil, crée des inscriptions. Comportement deny-orphan désactivé sur cette app — au contraire, on **crée** `/users/{uid}` à la fin du profil avec `roles: ['parent']` (ou `[]` si inscription pour soi-même majeur). |
| **Parent** | `/users/{uid}` avec `'parent' ∈ roles` | Voit ses inscriptions et celles de ses pupilles (`member.guardianUserIds CONTAINS uid`). |
| **Joueur majeur (self-registration)** | `/users/{uid}` lié à un `/members/{id}` via `member.linkedUserId` | Voit sa propre inscription. |
| **Coach** | Hors app register | Voit dans l'app web les inscriptions ciblant ses équipes. |
| **Admin** | Hors app register | Voit toutes les inscriptions, valide les licences. |

Le rôle `parent` est **déjà additif** (cf. `project_roles_additifs`) et coexiste avec `admin` / `coach` / `official`. Ce flow est donc compatible avec un parent qui est aussi coach du club.

## 3. Flow utilisateur — vue d'ensemble

```
[Landing] → [Sign-up Google/Apple/Email]
   → [Profil user] (email confirmé, adresse, téléphone)
   → [Pour qui ?] (moi / un enfant / un pupille)
   → [Identité joueur] (nom, prénom, DOB, AVS — obligatoire pour continuer)
        └─ Lookup member par AVS exact → si dossier trouvé, confirmation du rattachement
   → [Choix équipe] (filtrée par âge, status, horaires, manuel coach)
        ├─ Équipe ouverte    → [Manuel d'inscription du coach] → continue
        └─ Équipe sous-cond. → [Conditions du coach] → registration créée en "pending_review"
   → [Contact joueur] (téléphone recommandé, ancien club ?)
        └─ Ancien club ? → [Lettre de sortie] (upload optionnel)
              └─ Club à l'étranger ? → status "transfert international"
   → [Page info licence] (carte ID/passeport requise, paiement requis, etc.)
   → [Confirmation] → /registrations/{id} créée + notif coach + admin
```

L'inscription **n'émet pas de licence** automatiquement — c'est un workflow séparé déclenché par le coach après acceptation du joueur (voir section §5 du flow détaillé, repris dans [`functions.md`](./functions.md) et [`lifecycle.md`](./lifecycle.md)).

## Hors scope MVP / décisions différées

- **Paiement de cotisation en ligne** — l'utilisateur paie hors-bande (virement / espèces), l'admin marque "paid" dans l'app web. Stripe / Twint à brancher plus tard.
- **Multi-équipe pour un joueur** — au MVP, une registration = une équipe. Un joueur dans plusieurs équipes = plusieurs registrations (acceptable car cas rare). Voir si on consolide en post-MVP.
- **Versioning du formulaire de licence** — un seul template par club. Si la fédération change le template, l'admin met à jour le template en Storage.
- **Signature électronique réelle** — pour MVP, le user signe à la main + scan/photo. DocuSign / SignNow plus tard.
- **Vérification automatique des documents** (OCR de la pièce d'identité) — hors scope.
- **Anti-fraude** (numéro AVS validé contre l'algorithme officiel) — checksum côté client en validation, mais pas de lookup base AVS (impossible).
- **i18n** — FR uniquement pour MVP. La structure permet l'extraction des chaînes pour Phase 2.

## Hosting

`firebase.json` aura **deux targets** :
- `app` → `apps/web/dist` (existant)
- `register` → `apps/courtbase-register/dist` (nouveau)

Domaines suggérés (par-client, géré côté control-plane à la provisioning) :
- App admin : `{slug}.club.courtbase.app`
- App register : `inscriptions.{slug}.courtbase.app` ou `inscription.{slug}.club.courtbase.app`

L'URL exacte de l'app register est exposée comme `config/club.registerUrl` pour que l'app web puisse linker vers elle (boutons "Partager le lien d'inscription").

## Réutilisation depuis `apps/web`

- **Types** : 100% depuis `packages/shared-types`. Tous les nouveaux types vivent là (cf. [`schema.md`](./schema.md)).
- **Design system** : extraire un sous-ensemble des composants `apps/web/src/components/ui/*` vers `packages/ui` (futur) OU dupliquer pour MVP. **Décision** : dupliquer pour cette PR ; extraction en `packages/ui` traitée en chantier séparé.
- **Repositories** : pas de partage. Les patterns sont les mêmes (composable Pinia + repo), mais le scope est différent (un user voit ses propres registrations vs admin voit tout).
