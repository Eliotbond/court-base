import { computed } from 'vue';
const props = withDefaults(defineProps(), { size: 28 });
const initials = computed(() => {
    const parts = props.name.trim().split(/\s+/);
    if (parts.length === 0)
        return '?';
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});
const style = computed(() => ({
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.max(10, Math.round(props.size * 0.4))}px`,
}));
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_withDefaultsArg = (function (t) { return t; })({ size: 28 });
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "inline-flex items-center justify-center rounded-full bg-surface-200 font-semibold text-surface-900 shrink-0" },
    ...{ style: (__VLS_ctx.style) },
});
(__VLS_ctx.initials);
/** @type {__VLS_StyleScopedClasses['inline-flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-full']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-surface-200']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-surface-900']} */ ;
/** @type {__VLS_StyleScopedClasses['shrink-0']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            initials: initials,
            style: style,
        };
    },
    __typeProps: {},
    props: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeProps: {},
    props: {},
});
; /* PartiallyEnd: #4569/main.vue */
