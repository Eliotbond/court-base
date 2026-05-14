<script setup lang="ts">
import { ref } from 'vue'
import { FileText, RefreshCw, Trash2, Upload } from 'lucide-vue-next'

export type UploadState =
  | { kind: 'empty' }
  | { kind: 'uploading'; fileName: string; progress: number }
  | { kind: 'uploaded'; fileName: string; size: number; storagePath: string }
  | { kind: 'refused'; reason: string }

const props = withDefaults(
  defineProps<{
    label: string
    helper?: string | null
    file: UploadState
    accept?: string
  }>(),
  {
    accept: '.pdf,image/png,image/jpeg',
    helper: null,
  },
)

const emit = defineEmits<{
  (e: 'pick', file: File): void
  (e: 'remove'): void
  (e: 'retry'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function openPicker() {
  inputRef.value?.click()
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const f = target.files?.[0]
  if (f) emit('pick', f)
  // Reset pour permettre de re-piquer le même fichier.
  if (target) target.value = ''
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}
</script>

<template>
  <div
    class="doc-tile"
    :class="{
      uploaded: file.kind === 'uploaded',
      uploading: file.kind === 'uploading',
      refused: file.kind === 'refused',
    }"
  >
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      class="doc-tile__input"
      @change="onChange"
    />

    <template v-if="file.kind === 'empty'">
      <Upload :size="24" class="doc-tile__icon" />
      <div class="doc-tile__label">{{ label }}</div>
      <p v-if="helper" class="doc-tile__helper">{{ helper }}</p>
      <button
        type="button"
        class="btn btn-secondary btn-sm doc-tile__cta"
        @click="openPicker"
      >
        Choisir un fichier
      </button>
    </template>

    <template v-else-if="file.kind === 'uploading'">
      <div class="doc-tile__row">
        <FileText :size="20" />
        <div class="doc-tile__row-body">
          <div class="doc-tile__row-name">{{ file.fileName }}</div>
          <div class="doc-tile__row-sub">Envoi en cours…</div>
        </div>
      </div>
      <div class="barmini doc-tile__bar">
        <div :style="{ width: `${file.progress}%`, background: '#0ea5e9' }" />
      </div>
    </template>

    <template v-else-if="file.kind === 'uploaded'">
      <div class="doc-tile__row">
        <FileText :size="20" class="doc-tile__row-icon-emerald" />
        <div class="doc-tile__row-body">
          <div class="doc-tile__row-name">{{ file.fileName }}</div>
          <div class="doc-tile__row-sub">{{ humanSize(file.size) }} — envoyé</div>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-label="Supprimer"
          @click="emit('remove')"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </template>

    <template v-else>
      <div class="doc-tile__row">
        <FileText :size="20" class="doc-tile__row-icon-rose" />
        <div class="doc-tile__row-body">
          <div class="doc-tile__row-name">Envoi refusé</div>
          <div class="doc-tile__row-sub">{{ file.reason }}</div>
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-xs"
          @click="emit('retry')"
        >
          <RefreshCw :size="12" /> Réessayer
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.doc-tile__input {
  display: none;
}
.doc-tile__icon {
  color: #94a3b8;
}
.doc-tile__label {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.doc-tile__helper {
  font-size: 12px;
  color: #64748b;
  margin: 0;
  line-height: 1.5;
}
.doc-tile__cta {
  margin-top: 4px;
}
.doc-tile__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
}
.doc-tile__row-body {
  flex: 1;
  min-width: 0;
}
.doc-tile__row-name {
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
}
.doc-tile__row-sub {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
}
.doc-tile__row-icon-emerald {
  color: #047857;
}
.doc-tile__row-icon-rose {
  color: #be123c;
}
.doc-tile__bar {
  margin-top: 8px;
  width: 100%;
}
</style>
