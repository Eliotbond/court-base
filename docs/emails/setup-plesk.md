# Setup Plesk SMTP pour les notifications email

> Procédure de configuration du serveur mail Plesk pour permettre à
> `emailSender` (Cloud Function trigger sur `/pendingEmails/{id}`) d'envoyer
> des emails transactionnels au nom du club.
>
> Une instance par projet Firebase (= un club). Les credentials SMTP vivent
> en `defineSecret` dans Cloud Functions, pas dans le code.

## Vue d'ensemble

```
[Producteurs Functions]              [Sender Function]                    [Plesk]
 submitRegistration ─┐                                                  ┌─ SMTP
 markDuePaid          ─→ /pendingEmails ── trigger emailSender ── 587 →─┤
 (etc.)               ─┘ (Firestore)        + secrets SMTP_*            └─ boîte noreply@…
                                                                             └─ délivre à Gmail/Outlook/etc.
```

Le code (sender + templates) est **identique sur tous les projets clients**.
Seuls les secrets Firebase + la configuration DNS du domaine du club
diffèrent par tenant.

---

## 1. Création de la boîte d'envoi côté Plesk

Pour le projet **Marly** (`marly.basketball`) :

1. Plesk Panel → **Mail** → **Create Email Address**
2. Adresse : `noreply@marly.basketball`
3. Mot de passe : générer un mot de passe fort (≥ 24 chars, random). Garder
   dans 1Password / Bitwarden — il deviendra le secret `SMTP_PASS`.
4. **Désactiver IMAP/POP3** si l'interface Plesk le permet (la boîte ne sert
   qu'à émettre — pas besoin que quelqu'un s'y connecte pour lire). Sinon
   laisser activé mais ne pas distribuer les credentials.
5. **Désactiver auto-reply / forwarder** : par défaut Plesk en met aucun ;
   vérifier qu'il n'y a rien qui se déclenche sur les bounces entrants.

Pour les futurs clubs (multi-tenant) : répéter avec leur propre domaine
(`noreply@<club>.<tld>`) — une boîte par club + un secret par projet
Firebase.

---

## 2. Configuration DNS du domaine du club

**À faire UNE FOIS par domaine.** Sans ces enregistrements, Gmail/Outlook
mettront les mails en spam (ou les rejetteront purement).

Sur la zone DNS de `marly.basketball` :

### SPF (Sender Policy Framework)

```
@   TXT   "v=spf1 +a +mx +ip4:<ip-publique-serveur-plesk> -all"
```

Remplacer `<ip-publique-serveur-plesk>` par l'IP du serveur. Si Plesk envoie
depuis plusieurs IPs (load balancing), lister toutes avec `+ip4:X +ip4:Y`.
Le `-all` à la fin = **rejet strict** des envois depuis toute autre source.

Vérifier : `dig +short TXT marly.basketball | grep spf`

### DKIM (DomainKeys Identified Mail)

1. Plesk → **Mail Server Settings** → activer **DKIM signing**
2. Plesk génère une clé publique et fournit le record TXT à publier dans
   la zone DNS :

```
default._domainkey   TXT   "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0B... (clé publique)"
```

3. Publier ce TXT exactement comme fourni (la valeur peut être très longue).
4. Tester : `dig +short TXT default._domainkey.marly.basketball`

### DMARC (Domain-based Message Authentication, Reporting & Conformance)

```
_dmarc   TXT   "v=DMARC1; p=quarantine; rua=mailto:postmaster@marly.basketball; pct=100"
```

- `p=quarantine` : les mails non signés DKIM/SPF arrivent en spam (pas
  rejetés). Quand tout marche depuis 2-4 semaines, passer à `p=reject`.
- `rua=mailto:postmaster@…` : les rapports d'agrégation arrivent à cette
  adresse (utile pour vérifier la conformité ; créer la boîte
  `postmaster@marly.basketball` côté Plesk si elle n'existe pas).

### PTR (reverse DNS)

Le PTR (reverse DNS) de l'IP du serveur doit pointer vers `mail.marly.basketball`
(ou le hostname utilisé pour `SMTP_HOST`). À demander à l'hébergeur si ce
n'est pas déjà fait. Gmail/Outlook scorent négativement les serveurs sans
PTR cohérent.

Vérifier : `dig +short -x <ip-publique-serveur-plesk>` → doit retourner
`mail.marly.basketball.`

---

## 3. Vérification SMTP avant configuration Firebase

Tester depuis ton poste local avec [swaks](https://github.com/jetmore/swaks)
(installable via `brew install swaks` sur macOS) :

```bash
swaks --to ton-email-de-test@gmail.com \
      --from noreply@marly.basketball \
      --server mail.marly.basketball:587 \
      --tls \
      --auth-user noreply@marly.basketball \
      --auth-password '<password-Plesk>'
```

Tu dois voir `250 OK` à la fin et recevoir le mail dans la boîte de test.
Si erreur → vérifier port 587 ouvert, mot de passe correct, et que la boîte
existe bien côté Plesk.

---

## 4. Configuration des secrets Firebase

Une fois Plesk validé, configurer les **6 secrets** sur le projet Firebase
visé. Pour le dev (projet `court-base-44878`) :

```bash
firebase functions:secrets:set SMTP_HOST -P dev
# → entrer : mail.marly.basketball

firebase functions:secrets:set SMTP_PORT -P dev
# → entrer : 587

firebase functions:secrets:set SMTP_USER -P dev
# → entrer : noreply@marly.basketball

firebase functions:secrets:set SMTP_PASS -P dev
# → entrer : <password-Plesk>

firebase functions:secrets:set SMTP_FROM_ADDRESS -P dev
# → entrer : noreply@marly.basketball

firebase functions:secrets:set SMTP_FROM_NAME -P dev
# → entrer : Marly Basketball
```

Vérifier que les 6 sont posés :

```bash
firebase functions:secrets:access SMTP_HOST -P dev
# (et les 5 autres)
```

**Important** : les `defineSecret` sont attachés à la function via le param
`secrets: EMAIL_SECRETS` dans `functions/src/emails/sender.ts`. Une fois les
secrets posés ET le code déployé, la function peut les lire au runtime.

---

## 5. Déploiement de la function

Suivre la procédure standard (cf. `functions/CLAUDE.md` section "Avant de
deploy") :

```bash
# 1. Build local (catch les TS errors avant le buildpack Cloud Functions)
npm run build -w @club-app/functions

# 2. Repack du tarball shared-types (sinon le buildpack Cloud échoue —
#    cf. mémoire deploy_functions_monorepo_fix)
cd packages/shared-types && npm pack --pack-destination ../../functions/ && cd -

# 3. Deploy
firebase deploy --only functions:emailSender -P dev

# 4. Cleanup tarball
rm functions/club-app-shared-types-*.tgz
```

**Pas de binding IAM nécessaire** : `emailSender` est un trigger Firestore
(pas une callable HTTPS), donc il n'a pas besoin du
`allUsers/run.invoker` binding (cf. `[[deploy-functions-v2-invoker-binding]]`).

---

## 6. Test end-to-end

### Méthode 1 — Direct Firestore (test isolé du sender)

Dans la Console Firebase → Firestore → `/pendingEmails` → **Add document** :

| Champ | Type | Valeur |
|---|---|---|
| `to` | array | `["eliot.bondallaz@alpine-digital.ch"]` |
| `template` | string | `registration_submitted_confirm` |
| `context` | map | voir ci-dessous |
| `createdAt` | timestamp | (auto) |
| `sentAt` | null | `null` |
| `status` | string | `pending` |

Pour `context`, ajouter ces sous-champs (tous strings) :

- `submittedByUid` : `test-uid`
- `registrationId` : `test-reg-123`
- `teamId` : `test-team`
- `playerName` : `Test User`
- `status` : `pending_payment`

Sauver le doc → le trigger s'exécute en quelques secondes → vérifier :
- Le doc est mis à jour avec `status: "sent"` + `messageId` + `sentAt`
- L'email arrive bien dans la boîte de test

### Méthode 2 — Workflow réel

Soumettre une inscription depuis `register.marly.basketball` (dev). Le
callable `submitRegistration` crée le doc `/pendingEmails/{regId}_registration_submitted_confirm`
qui déclenche le sender.

### Méthode 3 — Inspecter les logs

```bash
gcloud logging read \
  'resource.type="cloud_function" AND resource.labels.function_name="emailSender"' \
  --project=court-base-44878 --limit=20 --format=json
```

Chercher les events `email.sent` (success) ou `email.failed` (échec, avec
`code` indiquant la cause : `no_recipients`, `unknown_template`,
`invalid_context`, `ECONNREFUSED`, etc.).

**RGPD-safe** : les logs ne contiennent **pas** les adresses email en clair,
uniquement un hash SHA-256 court (`toHash`) pour traçabilité.

---

## 7. Diagnostics courants

| Symptôme | Cause probable | Fix |
|---|---|---|
| Doc reste `status: "pending"` indéfiniment | Function pas déployée OU secrets pas attachés | Vérifier `firebase functions:list -P dev` + `firebase functions:secrets:access` |
| `status: "failed"` / `error: "no_recipients"` | Le doc a un `to: null` ou `[]` (pas d'email résoluble côté producteur) | Vérifier `member.linkedUserId` et `user.email` |
| `status: "failed"` / `error: "ECONNREFUSED"` | Port 587 fermé ou hostname SMTP incorrect | Tester depuis ton poste avec swaks |
| `status: "failed"` / `error: "EAUTH"` | Mot de passe SMTP incorrect | Rotate via `firebase functions:secrets:set SMTP_PASS` puis re-deploy |
| Mail envoyé mais arrive en spam | DKIM/SPF/DMARC pas configurés ou PTR incohérent | Tester sur https://www.mail-tester.com (envoyer depuis le club, copier le score) |
| `status: "failed"` / `error: "unknown_template"` | Le producteur écrit un `template` non encore implémenté côté registry | Ajouter le module dans `functions/src/emails/templates/` puis re-deploy |

---

## 8. Quotas et limites

Plesk défaut : **~100 emails/heure/boîte**. À ajuster côté serveur dans
**Tools & Settings** → **Mail Server Settings** → "Limit on outgoing email
messages".

Volume Marly estimé :
- Inscriptions : ~50/an × 1-3 emails = ~150 emails/an
- Cotisations : ~50 membres × 2 dues/an × 2 emails (request + confirmed) = 200/an
- Notifications licence : ~50 membres × 1-3 emails = 150/an
- **Total estimé : < 1000 emails/an** — très en dessous du quota par défaut.

Le sender est configuré avec `concurrency: 5` côté Cloud Functions pour
limiter les bursts (Plesk supporte mal le parallélisme SMTP).

---

## 9. Rotation des secrets

Si compromission soupçonnée :

```bash
# 1. Changer le mot de passe côté Plesk Panel
# 2. Mettre à jour le secret Firebase
firebase functions:secrets:set SMTP_PASS -P dev
# 3. Re-deploy pour que la nouvelle valeur soit chargée
firebase deploy --only functions:emailSender -P dev
```

Les secrets `defineSecret` sont versionnés ; les anciennes versions restent
accessibles via `firebase functions:secrets:access SMTP_PASS:<version>`.
Cleanup des anciennes versions via `firebase functions:secrets:destroy
SMTP_PASS:<version>` une fois la rotation confirmée.
