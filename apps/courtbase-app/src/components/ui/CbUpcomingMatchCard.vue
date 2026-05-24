<script setup lang="ts">
import { computed } from 'vue'
import { MapPin, Users } from 'lucide-vue-next'

import CbPill from './CbPill.vue'
import CbMatchTypeChip from './CbMatchTypeChip.vue'

/**
 * Card d'aperçu d'un match à venir (réutilisable hors `OpenMatches`).
 *
 * Variante enrichie de `CbMatchCard` : affiche explicitement `team vs
 * opponent` (au lieu de l'opponent seul), met en avant la liste des
 * officiels déjà inscrits (avatars + libellé "X officiel(s)") et conserve
 * la pill de type de match (AFBB / CSJC / …) en haut à droite.
 *
 * Match domicile : `My team vs Opponent`.
 * Match extérieur : `My team → Opponent` (chez l'adversaire).
 *
 * Pas de logique métier — purement présentationnel. Émet `click` sur la
 * card, charge au consommateur de naviguer.
 */
const props = defineProps<{
  /** Texte formaté FR — ex. "Mer. 9 sept." */
  date: string
  /** "HH:MM" */
  time: string
  /** Identifiant du type de match (mappé visuellement par `CbMatchTypeChip`). */
  matchType: string
  /** Équipe du club (côté local). */
  teamName: string
  /** Adversaire. */
  opponent: string
  /** Match extérieur ⇒ affiche `→` au lieu de `vs`. */
  away?: boolean
  /** Libellé lieu (salle + court ou adresse extérieure). */
  venue: string
  /** Initiales (2 lettres) des officiels inscrits — max 4 affichés. */
  officials?: ReadonlyArray<string>
  /** Staffing : visualisé en pill (emerald si complet, amber sinon). */
  staffing?: { filled: number; total: number; complete?: boolean }
}>()

defineEmits<{ click: [] }>()

const officialsList = computed<ReadonlyArray<string>>(() => props.officials ?? [])
const visibleOfficials = computed<ReadonlyArray<string>>(() =>
  officialsList.value.slice(0, 4),
)
const extraOfficialsCount = computed<number>(() =>
  Math.max(0, officialsList.value.length - 4),
)

const officialsCountLabel = computed<string>(() => {
  const total = officialsList.value.length
  if (total === 0) return 'Aucun officiel'
  if (total === 1) return '1 officiel'
  return `${total} officiels`
})
</script>

<template>
  <div
    class="cb-upcoming"
    role="button"
    tabindex="0"
    @click="$emit('click')"
    @keydown.enter.prevent="$emit('click')"
    @keydown.space.prevent="$emit('click')"
  >
    <!-- Top row : date/heure + pill type de match -->
    <div class="top">
      <div class="when">
        <span class="date">{{ date }}</span>
        <span class="time mono">{{ time }}</span>
      </div>
      <CbMatchTypeChip :type="matchType" />
    </div>

    <!-- Team vs Opponent -->
    <div class="versus">
      <span class="team home">{{ teamName || 'Mon équipe' }}</span>
      <span class="sep">{{ away ? '→' : 'vs' }}</span>
      <span class="team away">{{ opponent }}</span>
    </div>

    <!-- Lieu -->
    <div class="venue">
      <MapPin :size="14" />
      <span>{{ venue }}</span>
    </div>

    <!-- Footer : officiels inscrits + staffing -->
    <div class="footer">
      <div class="officials">
        <div class="officials-avatars">
          <span
            v-for="(o, i) in visibleOfficials"
            :key="i"
            class="cb-avatar xs"
          >{{ o }}</span>
          <span
            v-if="extraOfficialsCount > 0"
            class="cb-avatar xs slate extra"
          >+{{ extraOfficialsCount }}</span>
          <span
            v-if="officialsList.length === 0"
            class="cb-avatar xs slate placeholder"
            aria-hidden="true"
          >
            <Users :size="12" />
          </span>
        </div>
        <span class="officials-count">{{ officialsCountLabel }}</span>
      </div>
      <CbPill
        v-if="staffing"
        :tone="staffing.complete ? 'emerald' : 'amber'"
        dot
      >
        {{ staffing.complete ? 'Complet' : `À pourvoir ${staffing.filled}/${staffing.total}` }}
      </CbPill>
    </div>
  </div>
</template>

<style scoped>
.cb-upcoming {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}
.cb-upcoming:hover {
  transform: translateY(-1px);
  border-color: var(--slate-300, #cbd5e1);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

/* Top : date + match type pill */
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.when {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.when .date {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}
.when .time {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-subtle);
}

/* Team vs Team */
.versus {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
  flex-wrap: wrap;
}
.versus .team {
  min-width: 0;
}
.versus .team.home {
  color: var(--text);
}
.versus .team.away {
  color: var(--slate-700, #334155);
}
.versus .sep {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-subtle);
  padding: 2px 6px;
  background: var(--slate-100, #f1f5f9);
  border-radius: 6px;
  flex-shrink: 0;
}

/* Lieu */
.venue {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-subtle);
}
.venue span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer : officiels + staffing */
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.officials {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.officials-avatars {
  display: flex;
  align-items: center;
}
.officials-avatars .cb-avatar {
  box-shadow: 0 0 0 2px var(--bg);
  margin-left: -8px;
}
.officials-avatars .cb-avatar:first-child {
  margin-left: 0;
}
.officials-avatars .cb-avatar.placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.officials-avatars .cb-avatar.extra {
  font-weight: 700;
}
.officials-count {
  font-size: 12px;
  color: var(--text-subtle);
  font-weight: 500;
}
</style>
