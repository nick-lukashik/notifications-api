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
        coins: string
        amount: string
        currency: string
        idWebUrl: string
    }
}
export type TemplateKey = keyof Templates

const ruPlural = new Intl.PluralRules('ru')
const enPlural = new Intl.PluralRules('en')

/** "1 coin", "550 coins"; "1 монета", "2 монеты", "550 монет". */
export function coinsText(amount: string, locale: Locale): string {
    const count = Number(amount)
    if (locale === 'ru') {
        const word = {
            one: 'монета',
            few: 'монеты',
            many: 'монет',
        }[ruPlural.select(count) as 'one' | 'few' | 'many']
        return `${amount} ${word ?? 'монеты'}`
    }
    return `${amount} ${enPlural.select(count) === 'one' ? 'coin' : 'coins'}`
}

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
        en: ({ coins, amount, currency, idWebUrl }) => ({
            subject: `Payment received: ${coinsText(coins, 'en')}`,
            text: `We received ${amount} ${currency}. ${coinsText(coins, 'en')} are on your wallet: ${idWebUrl}/wallet`,
        }),
        ru: ({ coins, amount, currency, idWebUrl }) => ({
            subject: `Оплата получена: ${coinsText(coins, 'ru')}`,
            text: `Мы получили ${amount} ${currency}. На кошелёк зачислено: ${coinsText(coins, 'ru')}. ${idWebUrl}/wallet`,
        }),
    },
}

export function render<K extends TemplateKey>(key: K, locale: Locale, params: Templates[K]): Rendered {
    return text[key][locale](params)
}
