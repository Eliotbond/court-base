import { computed } from 'vue';
const props = withDefaults(defineProps(), { kind: 'empty' });
const variantClass = computed(() => {
    switch (props.kind) {
        case 'training':
            return 'bg-blue-50 border-blue-200 text-blue-700';
        case 'match_home':
            return 'bg-emerald-50 border-emerald-300 text-emerald-700';
        case 'match_away':
            return 'bg-violet-50 border-violet-300 text-violet-700';
        case 'reserve':
            return 'bg-surface-100 border-surface-300 text-surface-600';
        case 'custom':
            return 'bg-amber-50 border-amber-300 text-amber-700';
        case 'empty':
        default:
            return 'bg-transparent border-dashed border-surface-200 text-transparent cursor-default';
    }
});
const isEmpty = computed(() => props.kind === 'empty');
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_withDefaultsArg = (function (t) { return t; })({ kind: 'empty' });
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "border rounded px-2 py-1.5 text-[11px] leading-tight overflow-hidden transition-transform" },
    ...{ class: ([
            __VLS_ctx.variantClass,
            __VLS_ctx.isEmpty ? '' : 'cursor-pointer hover:-translate-y-px hover:shadow-pop',
        ]) },
});
var __VLS_0 = {};
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['px-2']} */ ;
/** @type {__VLS_StyleScopedClasses['py-1.5']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[11px]']} */ ;
/** @type {__VLS_StyleScopedClasses['leading-tight']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-hidden']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-transform']} */ ;
// @ts-ignore
var __VLS_1 = __VLS_0;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            variantClass: variantClass,
            isEmpty: isEmpty,
        };
    },
    __typeProps: {},
    props: {},
});
const __VLS_component = (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeProps: {},
    props: {},
});
export default {};
; /* PartiallyEnd: #4569/main.vue */
