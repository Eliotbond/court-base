<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, BadgeAlert, CircleCheck, Lock } from 'lucide-vue-next'
import type { PublicTeam } from '@/repositories/teams.repo'

const props = defineProps<{
  team: PublicTeam
}>()

const emit = defineEmits<{ (e: 'pick', team: PublicTeam): void }>()

const isOpen = computed(() => props.team.registrationStatus === 'open')
const isConditional = computed(() => props.team.registrationStatus === 'conditional')
const isClosed = computed(() => props.team.registrationStatus === 'closed')

const coachInitials = computed(() => {
  const c = props.team.headCoach
  if (!c) return ''
  return ((c.firstName?.charAt(0) ?? '') + (c.lastName?.charAt(0) ?? '')).toUpperCase()
})

const avatarLabel = computed(() => {
  const name = props.team.name
  // Tronque à 4 chars pour matcher le design (ex. "U12M").
  return name.replace(/\s+/g, '').slice(0, 4).toUpperCase() || '—'
})

function onPick() {
  if (isClosed.value) return
  emit('pick', props.team)
}
</script>

<template>
  <div
    class="team-card"
    :class="{
      'team-card--open': isOpen,
      'team-card--conditional': isConditional,
      disabled: isClosed,
    }"
  >
    <div class="team-head">
      <div class="avatar team-card__avatar" :class="{
        'team-card__avatar--open': isOpen,
        'team-card__avatar--conditional': isConditional,
        'team-card__avatar--closed': isClosed,
      }">
        {{ avatarLabel }}
      </div>
      <div class="team-card__body">
        <div class="team-card__title-row">
          <h3 class="team-card__name">{{ team.name }}</h3>
          <span v-if="isOpen" class="pill pill-emerald">
            <CircleCheck :size="12" /> Ouverte
          </span>
          <span v-else-if="isConditional" class="pill pill-amber">
            <BadgeAlert :size="12" /> Sous conditions
          </span>
          <span v-else class="pill pill-slate">
            <Lock :size="12" /> Complète
          </span>
        </div>
        <div class="team-card__sub">
          {{ team.category?.name ?? '—' }}<template v-if="team.publicTagline"> · {{ team.publicTagline }}</template>
        </div>
      </div>
    </div>

    <div v-if="team.conditionalCriteria.length > 0 && !isClosed" class="team-card__chips">
      <span
        v-for="chip in team.conditionalCriteria"
        :key="chip"
        class="chip"
        :class="{ 'team-card__chip--amber': isConditional, 'team-card__chip--emerald': isOpen }"
      >
        {{ chip }}
      </span>
    </div>

    <div v-if="team.headCoach && !isClosed" class="team-card__coach">
      <div class="avatar team-card__coach-avatar ph-coach">{{ coachInitials }}</div>
      <div class="team-card__coach-line">
        <span class="team-card__coach-tag">Coach</span>
        <span class="team-card__coach-name">{{ team.headCoach.firstName }} {{ team.headCoach.lastName }}</span>
      </div>
    </div>

    <div v-if="!isClosed" class="team-card__actions">
      <button
        type="button"
        class="btn btn-primary btn-sm btn-block"
        @click="onPick"
      >
        Choisir <ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.team-card {
  padding: 14px;
  margin-top: 12px;
}
.team-card--open {
  border-color: #a7f3d0;
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 50%);
}
.team-card--conditional {
  border-color: #fde68a;
}
.team-card__avatar {
  width: 40px;
  height: 40px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: white;
  background: #94a3b8;
}
.team-card__avatar--open {
  background: #10b981;
}
.team-card__avatar--conditional {
  background: #b45309;
}
.team-card__avatar--closed {
  background: #cbd5e1;
}
.team-card__body {
  flex: 1;
  min-width: 0;
}
.team-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.team-card__name {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: #0f172a;
}
.team-card__sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}
.team-card__chips {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.team-card__chip--amber {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}
.team-card__chip--emerald {
  background: #f0fdf4;
  border-color: #a7f3d0;
  color: #047857;
}
.team-card__coach {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eef2f6;
  display: flex;
  align-items: center;
  gap: 8px;
}
.team-card__coach-avatar {
  width: 28px;
  height: 28px;
  font-size: 11px;
}
.team-card__coach-tag {
  color: #64748b;
  font-size: 12px;
}
.team-card__coach-name {
  font-weight: 500;
  font-size: 12px;
  color: #0f172a;
  margin-left: 4px;
}
.team-card__actions {
  margin-top: 12px;
}
</style>
