<script setup lang="ts">
/**
 * Banner FIBA — affiché dans `LicenseRequestForm` quand le joueur vient d'un
 * ancien club étranger (`previouslyLicensed && previousClubAbroad`).
 *
 * Composé de 1 à 4 sous-banners :
 *  - Principal (toujours) : transfert international détecté + Letter of
 *    Clearance / FIBA MAP géré par le club.
 *  - Conditionnel `hasCompetition === true` : Letter of Clearance requise.
 *  - Conditionnel `hasCompetition === false` : procédure FIBA MAP allégée.
 *  - Conditionnel `isMinor === true` : pièces supplémentaires U18 (admin
 *    recontactera).
 *  - Warning permanent en bas : déclaration FIBA (omission = amende club).
 *
 * Le texte est volontairement non éditable par configuration — c'est de la
 * doctrine fédérale, on la copie verbatim. Toute modif passe par une PR.
 */
import { AlertTriangle, BadgeAlert, Globe, Info } from 'lucide-vue-next'

defineProps<{
  /** `null` = parent n'a pas encore répondu au toggle. */
  hasCompetition: boolean | null
  isMinor: boolean
  level?: 'LNA' | 'LNB' | 'regional'
}>()
</script>

<template>
  <div class="ftb">
    <!-- Banner principal — toujours visible -->
    <div class="banner banner-info ftb__item">
      <Globe :size="16" class="banner-icon" />
      <div class="ftb__body">
        <div class="ftb__title">Transfert international détecté</div>
        <p class="ftb__text">
          Comme votre ancien club est à l'étranger, Swiss Basketball doit obtenir
          une autorisation officielle de la fédération du pays d'origine via la
          procédure FIBA MAP (Movement Authorization Procedure).
        </p>
        <p class="ftb__text ftb__text--spaced">
          Cette démarche est <strong>gérée par le club</strong> — vous n'avez rien
          à uploader ici. Notre administration vous contactera pour les pièces
          complémentaires et vous informera des frais (CHF 269.25 facturés par
          FIBA via MAP).
        </p>
      </div>
    </div>

    <!-- Si compétition étrangère confirmée -->
    <div
      v-if="hasCompetition === true"
      class="banner banner-warn ftb__item"
    >
      <AlertTriangle :size="16" class="banner-icon" />
      <div class="ftb__body">
        <div class="ftb__title">Letter of Clearance requise</div>
        <p class="ftb__text">
          Vous avez indiqué que le joueur a participé à des compétitions
          officielles à l'étranger. La fédération du pays précédent doit délivrer
          une <strong>Letter of Clearance</strong> confirmant qu'il/elle est libre
          de licence. Notre administration s'en occupera dès réception de votre
          demande.
        </p>
      </div>
    </div>

    <!-- Si pas de compétition étrangère -->
    <div
      v-else-if="hasCompetition === false"
      class="banner banner-info ftb__item"
    >
      <Info :size="16" class="banner-icon" />
      <div class="ftb__body">
        <div class="ftb__title">
          Procédure simplifiée — « joueur sans compétition à l'étranger »
        </div>
        <p class="ftb__text">
          Si le joueur n'a effectivement participé à aucune compétition fédérale
          à l'étranger, une procédure FIBA MAP allégée s'applique. Cela reste
          géré côté club.
        </p>
      </div>
    </div>

    <!-- Si mineur — pièces U18 supplémentaires -->
    <div
      v-if="isMinor"
      class="banner banner-warn ftb__item"
    >
      <BadgeAlert :size="16" class="banner-icon" />
      <div class="ftb__body">
        <div class="ftb__title">
          Joueur mineur (moins de 18 ans) — pièces supplémentaires
        </div>
        <p class="ftb__text">
          La procédure U18 internationale est plus stricte. Le club vous demandera :
          permis de séjour valide en Suisse, attestation de domicile/scolarisation,
          consentement parental signé, National Team Declaration. Vous n'avez rien
          à uploader maintenant — l'administration vous recontactera.
        </p>
      </div>
    </div>

    <!-- Warning permanent — déclaration FIBA -->
    <div class="banner banner-strong ftb__item">
      <AlertTriangle :size="16" class="banner-icon" />
      <div class="ftb__body">
        <p class="ftb__text">
          <strong>⚠ Déclarez tout antécédent fédéral, même en jeunesse.</strong>
          La procédure FIBA MAP croise automatiquement les bases de toutes les
          fédérations nationales. Une omission entraîne une amende infligée au club.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ftb {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ftb__item {
  align-items: flex-start;
}
.ftb__body {
  flex: 1;
  min-width: 0;
}
.ftb__title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.ftb__text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
}
.ftb__text--spaced {
  margin-top: 6px;
}
</style>
