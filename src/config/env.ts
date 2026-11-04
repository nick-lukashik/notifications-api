import { z } from 'zod'
import {
    baseEnvSchema,
    defineEnv,
    metricsEnvSchema,
    postgresEnvSchema,
    rabbitEnvSchema,
} from '../common/config/define-env.js'

const secret = z.string().min(32, 'at least 32 characters')

/** Every variable this service reads. Nothing else touches process.env. */
export const envSchema = baseEnvSchema
    .extend(postgresEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
        /** Access tokens of id-api (JWKS, issuer, audience). */
        ID_JWKS_URL: z.url().default('http://id-api.prod.svc/.well-known/jwks.json'),
        TOKEN_ISSUER: z.url().default('https://id.nick-lukashik.com'),
        TOKEN_AUDIENCE: z.string().min(1).default('nick-lukashik'),
        /** id-api inside the cluster and its service token: where to send an email. */
        ID_API_URL: z.url().default('http://id-api.prod.svc'),
        ID_INTERNAL_TOKEN: secret,
        /** This service's token for in-cluster callers (id-api sends sign-in codes). */
        INTERNAL_API_TOKEN: secret,
        /** `smtp` sends; `log` only logs that a message would go out (local runs, stage without mail). */
        MAIL_TRANSPORT: z
            .enum([
                'smtp',
                'log',
            ])
            .default('smtp'),
        SMTP_URL: z.string().optional(),
        /** Resend sends for mail.nick-lukashik.com (infra/terraform/cloudflare, the resend records). */
        MAIL_FROM: z.string().min(3).default('nick-lukashik <no-reply@mail.nick-lukashik.com>'),
        /** Links in emails. */
        ID_WEB_URL: z.url().default('https://id.nick-lukashik.com'),
    })
    .refine(value => value.MAIL_TRANSPORT !== 'smtp' || Boolean(value.SMTP_URL), {
        path: [
            'SMTP_URL',
        ],
        message: 'required when MAIL_TRANSPORT=smtp',
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
