import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FirebaseError } from 'firebase/app';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Divider from 'primevue/divider';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { NotAuthorizedError } from '@/repositories/users.repo';
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref(null);
function messageFor(code) {
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
            return 'Email ou mot de passe incorrect.';
        case 'auth/invalid-email':
            return 'Adresse email invalide.';
        case 'auth/user-disabled':
            return 'Ce compte est désactivé.';
        case 'auth/too-many-requests':
            return 'Trop de tentatives. Réessayez plus tard.';
        case 'auth/network-request-failed':
            return 'Problème réseau. Vérifiez votre connexion.';
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'Connexion annulée.';
        case 'auth/popup-blocked':
            return 'La fenêtre de connexion a été bloquée par le navigateur.';
        case 'auth/account-exists-with-different-credential':
            return 'Un compte existe déjà avec cet email, via un autre fournisseur.';
        case 'auth/operation-not-allowed':
            return 'Ce fournisseur n’est pas activé pour ce projet.';
        case 'auth/unauthorized-domain':
            return 'Ce domaine n’est pas autorisé pour cette connexion.';
        default:
            return 'Échec de la connexion. Réessayez.';
    }
}
function handleError(e) {
    if (e instanceof NotAuthorizedError) {
        error.value = 'Compte non autorisé. Demandez à votre admin de vous inviter.';
        return;
    }
    if (e instanceof FirebaseError) {
        error.value = messageFor(e.code);
        return;
    }
    error.value = 'Échec de la connexion. Réessayez.';
}
async function redirectAfterSignIn() {
    const redirect = route.query.redirect;
    const target = typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/';
    await router.replace(target);
}
async function onSubmit() {
    error.value = null;
    try {
        await auth.signIn(email.value, password.value);
        await redirectAfterSignIn();
    }
    catch (e) {
        handleError(e);
    }
}
async function onGoogle() {
    error.value = null;
    try {
        await auth.signInWithGoogle();
        await redirectAfterSignIn();
    }
    catch (e) {
        handleError(e);
    }
}
async function onApple() {
    error.value = null;
    try {
        await auth.signInWithApple();
        await redirectAfterSignIn();
    }
    catch (e) {
        handleError(e);
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['login__field']} */ ;
/** @type {__VLS_StyleScopedClasses['login__field']} */ ;
/** @type {__VLS_StyleScopedClasses['login__field']} */ ;
/** @type {__VLS_StyleScopedClasses['p-password']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "login" },
});
const __VLS_0 = {}.Card;
/** @type {[typeof __VLS_components.Card, typeof __VLS_components.Card, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ class: "login__card" },
}));
const __VLS_2 = __VLS_1({
    ...{ class: "login__card" },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
{
    const { title: __VLS_thisSlot } = __VLS_3.slots;
}
{
    const { content: __VLS_thisSlot } = __VLS_3.slots;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login__providers" },
    });
    const __VLS_4 = {}.Button;
    /** @type {[typeof __VLS_components.Button, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        ...{ 'onClick': {} },
        type: "button",
        label: "Continuer avec Google",
        icon: "pi pi-google",
        severity: "secondary",
        outlined: true,
        loading: (__VLS_ctx.auth.loading),
        disabled: (__VLS_ctx.auth.loading),
        ...{ class: "login__provider" },
    }));
    const __VLS_6 = __VLS_5({
        ...{ 'onClick': {} },
        type: "button",
        label: "Continuer avec Google",
        icon: "pi pi-google",
        severity: "secondary",
        outlined: true,
        loading: (__VLS_ctx.auth.loading),
        disabled: (__VLS_ctx.auth.loading),
        ...{ class: "login__provider" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
    let __VLS_8;
    let __VLS_9;
    let __VLS_10;
    const __VLS_11 = {
        onClick: (__VLS_ctx.onGoogle)
    };
    var __VLS_7;
    const __VLS_12 = {}.Button;
    /** @type {[typeof __VLS_components.Button, ]} */ ;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
        ...{ 'onClick': {} },
        type: "button",
        label: "Continuer avec Apple",
        icon: "pi pi-apple",
        severity: "secondary",
        outlined: true,
        loading: (__VLS_ctx.auth.loading),
        disabled: (__VLS_ctx.auth.loading),
        ...{ class: "login__provider" },
    }));
    const __VLS_14 = __VLS_13({
        ...{ 'onClick': {} },
        type: "button",
        label: "Continuer avec Apple",
        icon: "pi pi-apple",
        severity: "secondary",
        outlined: true,
        loading: (__VLS_ctx.auth.loading),
        disabled: (__VLS_ctx.auth.loading),
        ...{ class: "login__provider" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_13));
    let __VLS_16;
    let __VLS_17;
    let __VLS_18;
    const __VLS_19 = {
        onClick: (__VLS_ctx.onApple)
    };
    var __VLS_15;
    const __VLS_20 = {}.Divider;
    /** @type {[typeof __VLS_components.Divider, typeof __VLS_components.Divider, ]} */ ;
    // @ts-ignore
    const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
        align: "center",
    }));
    const __VLS_22 = __VLS_21({
        align: "center",
    }, ...__VLS_functionalComponentArgsRest(__VLS_21));
    __VLS_23.slots.default;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "login__divider-text" },
    });
    var __VLS_23;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.form, __VLS_intrinsicElements.form)({
        ...{ onSubmit: (__VLS_ctx.onSubmit) },
        ...{ class: "login__form" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login__field" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        for: "email",
    });
    const __VLS_24 = {}.InputText;
    /** @type {[typeof __VLS_components.InputText, ]} */ ;
    // @ts-ignore
    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
        id: "email",
        modelValue: (__VLS_ctx.email),
        type: "email",
        autocomplete: "email",
        required: true,
        disabled: (__VLS_ctx.auth.loading),
    }));
    const __VLS_26 = __VLS_25({
        id: "email",
        modelValue: (__VLS_ctx.email),
        type: "email",
        autocomplete: "email",
        required: true,
        disabled: (__VLS_ctx.auth.loading),
    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login__field" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        for: "password",
    });
    const __VLS_28 = {}.Password;
    /** @type {[typeof __VLS_components.Password, ]} */ ;
    // @ts-ignore
    const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
        inputId: "password",
        modelValue: (__VLS_ctx.password),
        feedback: (false),
        toggleMask: true,
        autocomplete: "current-password",
        required: true,
        disabled: (__VLS_ctx.auth.loading),
        inputProps: ({ required: true }),
    }));
    const __VLS_30 = __VLS_29({
        inputId: "password",
        modelValue: (__VLS_ctx.password),
        feedback: (false),
        toggleMask: true,
        autocomplete: "current-password",
        required: true,
        disabled: (__VLS_ctx.auth.loading),
        inputProps: ({ required: true }),
    }, ...__VLS_functionalComponentArgsRest(__VLS_29));
    if (__VLS_ctx.error) {
        const __VLS_32 = {}.Message;
        /** @type {[typeof __VLS_components.Message, typeof __VLS_components.Message, ]} */ ;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
            severity: "error",
            closable: (false),
        }));
        const __VLS_34 = __VLS_33({
            severity: "error",
            closable: (false),
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        __VLS_35.slots.default;
        (__VLS_ctx.error);
        var __VLS_35;
    }
    const __VLS_36 = {}.Button;
    /** @type {[typeof __VLS_components.Button, ]} */ ;
    // @ts-ignore
    const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
        type: "submit",
        label: "Se connecter",
        icon: "pi pi-sign-in",
        loading: (__VLS_ctx.auth.loading),
        ...{ class: "login__submit" },
    }));
    const __VLS_38 = __VLS_37({
        type: "submit",
        label: "Se connecter",
        icon: "pi pi-sign-in",
        loading: (__VLS_ctx.auth.loading),
        ...{ class: "login__submit" },
    }, ...__VLS_functionalComponentArgsRest(__VLS_37));
}
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['login']} */ ;
/** @type {__VLS_StyleScopedClasses['login__card']} */ ;
/** @type {__VLS_StyleScopedClasses['login__providers']} */ ;
/** @type {__VLS_StyleScopedClasses['login__provider']} */ ;
/** @type {__VLS_StyleScopedClasses['login__provider']} */ ;
/** @type {__VLS_StyleScopedClasses['login__divider-text']} */ ;
/** @type {__VLS_StyleScopedClasses['login__form']} */ ;
/** @type {__VLS_StyleScopedClasses['login__field']} */ ;
/** @type {__VLS_StyleScopedClasses['login__field']} */ ;
/** @type {__VLS_StyleScopedClasses['login__submit']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Button: Button,
            Card: Card,
            Divider: Divider,
            InputText: InputText,
            Message: Message,
            Password: Password,
            auth: auth,
            email: email,
            password: password,
            error: error,
            onSubmit: onSubmit,
            onGoogle: onGoogle,
            onApple: onApple,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
