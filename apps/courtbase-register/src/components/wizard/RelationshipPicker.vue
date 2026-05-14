<script setup lang="ts">
import type { RegistrationRelationship } from '@club-app/shared-types'

const props = defineProps<{
  relationship: RegistrationRelationship | null
  relationshipOther: string | null
}>()

const emit = defineEmits<{
  (e: 'update:relationship', value: RegistrationRelationship | null): void
  (e: 'update:relationshipOther', value: string | null): void
}>()

interface Option {
  value: RegistrationRelationship
  label: string
}

const OPTIONS: Option[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'legal_guardian', label: 'Tuteur légal' },
  { value: 'sibling', label: 'Frère / Sœur' },
  { value: 'caritas', label: 'Caritas / Asso.' },
  { value: 'other', label: 'Autre' },
]

function pick(value: RegistrationRelationship) {
  emit('update:relationship', value)
  if (value !== 'other') {
    emit('update:relationshipOther', null)
  }
}

function onOtherInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:relationshipOther', target.value || null)
}
</script>

<template>
  <div class="rel-picker">
    <div class="rel-picker__label">Quel est votre lien avec le joueur ?</div>
    <div class="rel-picker__grid">
      <button
        v-for="opt in OPTIONS"
        :key="opt.value"
        type="button"
        class="radio-card rel-picker__card"
        :class="{
          selected: props.relationship === opt.value,
          'rel-picker__card--full': opt.value === 'other',
        }"
        @click="pick(opt.value)"
      >
        <div class="radio-dot" />
        <div class="rel-picker__card-label">{{ opt.label }}</div>
        <input
          v-if="opt.value === 'other' && props.relationship === 'other'"
          class="input rel-picker__other"
          placeholder="Précisez…"
          :value="props.relationshipOther ?? ''"
          @input="onOtherInput"
          @click.stop
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.rel-picker {
  margin-top: 4px;
}
.rel-picker__label {
  font-size: 12.5px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 10px;
}
.rel-picker__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rel-picker__card {
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
}
.rel-picker__card--full {
  grid-column: span 2;
}
.rel-picker__card-label {
  font-size: 13px;
  font-weight: 500;
}
.rel-picker__other {
  flex: 1;
  height: 30px;
  margin-left: 8px;
}
</style>
