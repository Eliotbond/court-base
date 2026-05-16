# Comptabilité

> Module de comptabilité du club — **partie double**. Source de vérité produit du module « Comptabilité ». Pour le schéma Firestore brut et les rules, voir aussi `firebase.md`. Types : `packages/shared-types/src/accounting.ts`.
>
> Toute modification d'une règle métier, d'un schéma ou d'une rule de ce module doit être reflétée ici dans la même PR.

## 1. Vue d'ensemble

Le module Comptabilité permet au club de tenir une comptabilité en **partie double** : plan comptable paramétrable, journal des écritures, factures fournisseurs, et restitutions (bilan, compte de résultat, journal).

### Accès

Réservé **strictement** à deux profils :

| Profil | Identité |
|---|---|
| **Trésorier** | rôle additif `treasurer` sur `/users.roles` |
| **Root admin** | claim Auth `rootAdmin: true` |

L'**`admin` standard est exclu** du module — y compris au niveau `firestore.rules` : la comptabilité est une frontière de sécurité distincte des droits admin généraux. Un admin sans rôle `treasurer` ni claim `rootAdmin` ne peut ni lire ni écrire `/accounts`, `/accountingEntries`, `/invoices`.

### Partie double

Chaque opération financière est enregistrée comme une **écriture équilibrée** : la somme des débits égale la somme des crédits (`Σ débit === Σ crédit`). Une écriture comporte au moins deux lignes. C'est l'invariant fondamental du module.

## 2. Modèle comptable

### Écriture (`/accountingEntries`)

Une écriture comptable est un ensemble de **N lignes** (`N >= 2`), chaque ligne imputant un montant à un compte soit au **débit** soit au **crédit**. Sur une ligne, exactement un des deux montants (`debit`, `credit`) est `> 0`, l'autre vaut `0`. L'écriture est **équilibrée** : `Σ debit === Σ credit` sur l'ensemble des lignes.

### Saisie simplifiée (UI « un côté »)

L'utilisateur ne saisit en général qu'**un seul côté** de l'écriture (ex. « j'ai reçu 500 CHF de sponsoring »). L'UI complète automatiquement la **contrepartie** sur un **compte de trésorerie** (`isTreasury: true` — Caisse ou Banque). C'est le rôle du flag `account.isTreasury` : identifier les comptes éligibles comme contrepartie automatique. L'écriture finale reste une écriture équilibrée standard à 2 lignes.

### Append-only — annulation par contre-passation

`/accountingEntries` est **append-only** : aucune écriture n'est jamais supprimée (`allow delete: if false` dans les rules). Pour annuler une écriture erronée, on crée une **contre-passation** : une nouvelle écriture qui inverse débits et crédits de l'écriture d'origine.

- L'écriture d'origine est marquée `reversed: true`.
- L'écriture de contre-passation porte `reversalOfEntryId` = id de l'écriture d'origine, et `source: 'manual'`.

Le journal conserve ainsi l'historique complet (audit), et le solde net des deux écritures est nul.

## 3. Schéma

Trois collections racine, paths plats (un projet Firebase = un club) :

```
/accounts/{accountId}
/accountingEntries/{entryId}
/invoices/{invoiceId}
```

### `/accounts/{accountId}` — plan comptable

```ts
{
  number: string          // code comptable, unique (ex. "3000")
  name: string
  nature: "actif" | "passif" | "charge" | "produit"
  isTreasury: boolean     // true = compte de trésorerie (Caisse/Banque), contrepartie auto
  description: string | null
  isDefault: boolean      // true = compte seedé par défaut (protégé en suppression)
  active: boolean
  displayOrder: number    // tri stable (plan comptable, pickers)
  createdAt: Timestamp
}
```

- **`number`** : code comptable unique. L'unicité est une convention applicative (pas enforced par les rules).
- **`nature`** : détermine le sens du solde (cf. §4).
- **`isTreasury`** : marque les comptes Caisse / Banque. Utilisés comme contrepartie automatique dans la saisie simplifiée.
- **`isDefault`** : `true` pour les comptes seedés au démarrage du module. Ces comptes sont **protégés en suppression** (un compte par défaut peut être désactivé via `active: false`, mais pas supprimé). Les comptes créés manuellement par le trésorier ont `isDefault: false`.

### `/accountingEntries/{entryId}` — journal

```ts
{
  date: Timestamp
  label: string
  reference: string | null            // n° de pièce, libellé externe
  source: "credit" | "invoice" | "manual"
  invoiceId: string | null            // ref /invoices si source === 'invoice'
  lines: AccountingEntryLine[]         // >= 2 lignes, équilibrées : Σ debit === Σ credit
  reversed: boolean                    // true si l'écriture a été contre-passée
  reversalOfEntryId: string | null     // si cette écriture EST une contre-passation
  createdBy: string                    // uid trésorier / rootAdmin
  createdAt: Timestamp
}

interface AccountingEntryLine {
  accountId: string
  debit: number    // >= 0
  credit: number   // >= 0 — exactement un des deux > 0, l'autre = 0
}
```

- **`source`** : origine de l'écriture — `credit` (saisie d'un crédit), `invoice` (liée à une facture), `manual` (saisie générique).
- **`invoiceId`** : renseigné uniquement si `source === 'invoice'`.
- **`lines`** : au moins 2 lignes. Invariant équilibre `Σ debit === Σ credit` validé côté applicatif avant écriture.
- **`reversed` / `reversalOfEntryId`** : mécanique de contre-passation (cf. §2).

### `/invoices/{invoiceId}` — factures fournisseurs

```ts
{
  supplierName: string
  invoiceNumber: string | null
  issueDate: Timestamp
  dueDate: Timestamp | null
  amount: number                       // total, CHF
  currency: string                     // 'CHF' par défaut
  storagePath: string | null           // fichier uploadé dans Storage
  status: "to_pay" | "paid" | "cancelled"
  expenseAccountId: string | null      // compte de charge imputé
  entryId: string | null               // écriture liée (null tant que pas comptabilisée)
  ocrStatus: "none" | "pending" | "done" | "failed"   // 'none' en v1 (OCR différé)
  ocrRawText: string | null
  notes: string | null
  createdBy: string                    // uid trésorier / rootAdmin
  createdAt: Timestamp
}
```

- **`status`** : `to_pay` (saisie, en attente de règlement) → `paid` (réglée) ; `cancelled` (annulée).
- **`expenseAccountId`** : compte de charge sur lequel la facture est imputée. `null` tant que la facture n'est pas qualifiée.
- **`entryId`** : écriture comptable liée. `null` tant que la facture n'est pas comptabilisée (cf. §5).
- **`storagePath`** : fichier scan/PDF dans Storage (`accounting/invoices/{invoiceId}/{file}`).
- **`ocrStatus` / `ocrRawText`** : champs réservés OCR — inertes en v1 (cf. §6).

### Comptes par défaut

Comptes seedés au démarrage du module (par l'app web). Tous : `isDefault: true`, `active: true`, `description: null`, `displayOrder` = index×10, `createdAt` = server timestamp.

| number | name | nature | isTreasury |
|---|---|---|---|
| 1000 | Caisse | actif | true |
| 1020 | Banque | actif | true |
| 1100 | Débiteurs cotisations | actif | false |
| 2000 | Créditeurs (fournisseurs) | passif | false |
| 3000 | Cotisations des membres | produit | false |
| 3200 | Sponsoring | produit | false |
| 3400 | Subventions J+S | produit | false |
| 4000 | Frais de matériel | charge | false |
| 4200 | Frais d'arbitrage | charge | false |
| 6500 | Frais administratifs | charge | false |

## 4. Conventions de calcul

### Solde d'un compte

Le sens du solde dépend de la `nature` du compte :

| Nature | Solde |
|---|---|
| `actif`, `charge` | `Σ débit − Σ crédit` |
| `passif`, `produit` | `Σ crédit − Σ débit` |

Le solde d'un compte se calcule en agrégeant toutes les lignes d'écriture qui le référencent (`line.accountId === account.id`).

### Bilan

État du patrimoine à une date donnée :

- **Actif** = comptes de nature `actif` (soldes).
- **Passif** = comptes de nature `passif` (soldes) **+ le résultat de l'exercice**.

Le **résultat de l'exercice** (cf. compte de résultat ci-dessous) figure côté passif du bilan : un bénéfice augmente les fonds propres, une perte les diminue. Le bilan est équilibré par construction (conséquence de la partie double).

### Compte de résultat

Confrontation des charges et des produits sur l'exercice :

- **Charges** = comptes de nature `charge` (soldes).
- **Produits** = comptes de nature `produit` (soldes).
- **Résultat** = `Σ produits − Σ charges`. Positif = bénéfice, négatif = perte.

### Journal

Liste **chronologique** de toutes les écritures (`/accountingEntries`), triée par `date`. Restitution brute de l'historique, contre-passations incluses.

> Volumes faibles attendus → lectures par query simple + tri JS, **pas d'index composite** (cf. règle 10 du `CLAUDE.md` racine). `firestore.indexes.json` n'est pas modifié par ce module.

## 5. Flux de saisie

### Saisie d'un crédit (cash, sponsoring, subvention J+S)

L'utilisateur enregistre une **entrée d'argent**. Écriture (`source: 'credit'`) :

- **Crédit** d'un compte de **produit** (ou d'`actif` selon le cas) — ex. `3200 Sponsoring`.
- **Débit** d'un compte de **trésorerie** en contrepartie automatique — ex. `1020 Banque` ou `1000 Caisse`.

Exemple — sponsoring de 500 CHF reçu sur le compte bancaire :

| Compte | Débit | Crédit |
|---|---|---|
| 1020 Banque | 500 | 0 |
| 3200 Sponsoring | 0 | 500 |

### Facture fournisseur

Deux temps :

1. **Comptabilisation** de la facture (`status: to_pay`) — écriture (`source: 'invoice'`, `invoiceId` renseigné) :
   - **Débit** du compte de **charge** imputé (`invoice.expenseAccountId`) — ex. `4000 Frais de matériel`.
   - **Crédit** de `2000 Créditeurs (fournisseurs)` (passif).
   - L'écriture créée est référencée dans `invoice.entryId`.

   Exemple — facture matériel 300 CHF :

   | Compte | Débit | Crédit |
   |---|---|---|
   | 4000 Frais de matériel | 300 | 0 |
   | 2000 Créditeurs (fournisseurs) | 0 | 300 |

2. **Passage à payé** (`status: to_pay → paid`) — écriture de règlement (`source: 'manual'` ou `'invoice'`) :
   - **Débit** de `2000 Créditeurs (fournisseurs)`.
   - **Crédit** d'un compte de **trésorerie** (`1000 Caisse` / `1020 Banque`).

   | Compte | Débit | Crédit |
   |---|---|---|
   | 2000 Créditeurs (fournisseurs) | 300 | 0 |
   | 1020 Banque | 0 | 300 |

### Saisie manuelle (débit / écriture générique)

Pour toute opération ne relevant pas d'un crédit standard ou d'une facture : écriture (`source: 'manual'`) à **2 comptes libres** choisis par le trésorier (un au débit, un au crédit), montant équilibré. Sert aussi aux contre-passations (cf. §2) et aux régularisations.

## 6. OCR

L'extraction automatique des données de facture (OCR) est **différée** : la v1 repose sur la **saisie manuelle** des factures. Le schéma `/invoices` prévoit déjà les champs `ocrStatus` et `ocrRawText`, qui restent **inertes** en v1 (`ocrStatus: 'none'`, `ocrRawText: null`). Ils seront activés dans une itération ultérieure sans changement de schéma.

## 7. Sécurité

### Rules Firestore

```
match /accounts/{id} {
  allow read, write: if isRootAdmin() || isTreasurer();
}
match /accountingEntries/{id} {
  allow read, create, update: if isRootAdmin() || isTreasurer();
  allow delete: if false;          // append-only : annulation = contre-passation
}
match /invoices/{id} {
  allow read, write: if isRootAdmin() || isTreasurer();
}
```

- **`isTreasurer()`** : helper existant de `firestore.rules` (`hasRole('treasurer')` — signed-in ET `'treasurer'` dans `userDoc().roles`).
- **Exclusion de l'admin standard** : aucune des trois rules ne mentionne `isAdmin()`. Un admin sans rôle `treasurer` ni claim `rootAdmin` est refusé en lecture comme en écriture.
- **Pas de wildcard global** : `firestore.rules` ne contient aucune rule `match /{document=**}` qui ouvrirait l'accès admin à ces collections — l'exclusion admin est donc effective sans refactor.
- **Append-only** sur `/accountingEntries` : `allow delete: if false`. L'annulation passe exclusivement par contre-passation.

### Storage

Path des fichiers de factures (`storage.rules`) :

```
match /accounting/invoices/{invoiceId}/{file} {
  allow read: if request.auth != null;
  allow write: if request.auth != null
    && request.resource.size < 10 * 1024 * 1024
    && (request.resource.contentType.matches('image/.*')
        || request.resource.contentType == 'application/pdf');
}
```

Les Storage rules ne peuvent pas faire de cross-document lookup pour vérifier le rôle. La garde réelle treasurer/rootAdmin est donc portée par la collection Firestore `/invoices` (write treasurer-only) qui détient le `storagePath` : un non-trésorier ne lit pas `/invoices` et n'a donc pas connaissance du path.

## 8. Limites v1 / itérations futures

- **OCR** — extraction automatique des factures différée (cf. §6). Champs `ocrStatus` / `ocrRawText` réservés.
- **Multi-exercices / clôture annuelle** — v1 ne gère pas la notion d'exercice comptable borné ni la clôture annuelle (report à nouveau, soldes d'ouverture). Le journal est continu.
- **Export PDF** — pas d'export PDF du bilan, du compte de résultat ni du journal en v1.
- **Lettrage** — pas de rapprochement automatique facture ↔ écriture de règlement au-delà du lien `invoice.entryId`.
- **Validation serveur de l'équilibre** — l'invariant `Σ debit === Σ credit` est validé côté applicatif (web) en v1 ; pas de Cloud Function de contrôle.
