import { computed } from 'vue';
const props = withDefaults(defineProps(), { variant: 'slate', strike: false });
const variantClass = computed(() => {
    switch (props.variant) {
        case 'emerald':
            return 'bg-emerald-50 text-emerald-700';
        case 'sky':
            return 'bg-sky-50 text-sky-700';
        case 'amber':
            return 'bg-amber-50 text-amber-700';
        case 'rose':
            return 'bg-rose-50 text-rose-700';
        case 'violet':
            return 'bg-violet-50 text-violet-700';
        case 'slate':
        default:
            return 'bg-surface-100 text-surface-600';
    }
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_withDefaultsArg = (function (t) { return t; })({ variant: 'slate', strike: false });
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "inline-flex items-center gap-1 h-5 px-[7px] rounded text-[11px] font-medium leading-none whitespace-nowrap" },
    ...{ class: ([__VLS_ctx.variantClass, __VLS_ctx.strike ? 'line-through opacity-70' : '']) },
});
var __VLS_0 = {};
/** @type {__VLS_StyleScopedClasses['inline-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['gap-1']} */ ;
/** @type {__VLS_StyleScopedClasses['h-5']} */ ;
/** @type {__VLS_StyleScopedClasses['px-[7px]']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-[11px]']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['leading-none']} */ ;
/** @type {__VLS_StyleScopedClasses['whitespace-nowrap']} */ ;
// @ts-ignore
var __VLS_1 = __VLS_0;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            variantClass: variantClass,
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
