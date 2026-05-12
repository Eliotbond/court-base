const model = defineModel({ default: false });
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_defaults = {
    'modelValue': false,
};
const __VLS_modelEmit = defineEmits();
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.model = !__VLS_ctx.model;
        } },
    type: "button",
    role: "switch",
    'aria-checked': (__VLS_ctx.model),
    ...{ class: "relative w-[30px] h-[18px] rounded-full transition-colors" },
    ...{ class: (__VLS_ctx.model ? 'bg-emerald-500' : 'bg-surface-300') },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span)({
    ...{ class: "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-[left] duration-150" },
    ...{ class: (__VLS_ctx.model ? 'left-[14px]' : 'left-[2px]') },
});
/** @type {__VLS_StyleScopedClasses['relative']} */ ;
/** @type {__VLS_StyleScopedClasses['w-[30px]']} */ ;
/** @type {__VLS_StyleScopedClasses['h-[18px]']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-full']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-colors']} */ ;
/** @type {__VLS_StyleScopedClasses['absolute']} */ ;
/** @type {__VLS_StyleScopedClasses['top-[2px]']} */ ;
/** @type {__VLS_StyleScopedClasses['w-[14px]']} */ ;
/** @type {__VLS_StyleScopedClasses['h-[14px]']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-full']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-[left]']} */ ;
/** @type {__VLS_StyleScopedClasses['duration-150']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            model: model,
        };
    },
    __typeEmits: {},
    __typeProps: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
    __typeProps: {},
});
; /* PartiallyEnd: #4569/main.vue */
