import type { Locale } from '@nick-lukashik/contracts'

export type Rendered = {
    subject: string
    text: string
}

type Templates = {
    'auth.code': {
        code: string
        minutes: number
    }
    welcome: {
        idWebUrl: string
    }
    receipt: {
        grm: string
        amount: string
        currency: string
        idWebUrl: string
    }
}
export type TemplateKey = keyof Templates

const text: {
    [K in TemplateKey]: Record<Locale, (params: Templates[K]) => Rendered>
} = {
    'auth.code': {
        en: ({ code, minutes }) => ({
            subject: `${code} is your sign-in code`,
            text: `Your sign-in code: ${code}\n\nIt works for ${minutes} minutes. If you did not ask for it, ignore this email.`,
        }),
        ru: ({ code, minutes }) => ({
            subject: `${code} — код для входа`,
            text: `Ваш код для входа: ${code}\n\nОн действует ${minutes} минут. Если вы его не запрашивали, просто проигнорируйте письмо.`,
        }),
    },
    welcome: {
        en: ({ idWebUrl }) => ({
            subject: 'Welcome to nick-lukashik',
            text: `Your account is ready. Wallet, payments and settings: ${idWebUrl}`,
        }),
        ru: ({ idWebUrl }) => ({
            subject: 'Добро пожаловать в nick-lukashik',
            text: `Аккаунт создан. Кошелёк, платежи и настройки: ${idWebUrl}`,
        }),
    },
    receipt: {
        en: ({ grm, amount, currency, idWebUrl }) => ({
            subject: `Payment received: ${grm} GRM`,
            text: `We received ${amount} ${currency}. ${grm} GRM are on your wallet: ${idWebUrl}/wallet`,
        }),
        ru: ({ grm, amount, currency, idWebUrl }) => ({
            subject: `Оплата получена: ${grm} GRM`,
            text: `Мы получили ${amount} ${currency}. ${grm} GRM зачислены на кошелёк: ${idWebUrl}/wallet`,
        }),
    },
}

export function render<K extends TemplateKey>(key: K, locale: Locale, params: Templates[K]): Rendered {
    return text[key][locale](params)
}
