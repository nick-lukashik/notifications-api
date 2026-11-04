import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ApiExcludeController } from '@nestjs/swagger'
import { Internal } from '@nick-lukashik/auth/nest'
import { localeSchema } from '@nick-lukashik/contracts'
import { z } from 'zod'
import { mailConfig } from '../config/config.js'
import { Deliveries, redact } from '../mail/deliveries.js'
import { MailTransport } from '../mail/mail-transport.js'
import { render } from '../mail/templates.js'

const authCodeSchema = z.object({
    challengeId: z.uuid(),
    email: z.email().max(254),
    code: z.string().regex(/^[0-9]{6}$/),
    locale: localeSchema,
    expiresAt: z.iso.datetime(),
})
type AuthCode = z.infer<typeof authCodeSchema>

/**
 * Sign-in codes from id-api, sent synchronously. The code and the address are
 * never stored or logged here: only `auth-code:<challengeId>` and its status.
 * A code past its expiry is not sent.
 */
@ApiExcludeController()
@Controller('internal/auth-codes')
@Internal()
export class AuthCodesController {
    private readonly logger = new Logger('AuthCodes')

    constructor(
        private readonly transport: MailTransport,
        private readonly deliveries: Deliveries,
        @Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async send(
        @Body({
            schema: authCodeSchema,
        })
        body: AuthCode,
    ): Promise<{
        status: 'accepted' | 'failed'
    }> {
        const key = `auth-code:${body.challengeId}`
        if (await this.deliveries.alreadyAccepted(key))
            return {
                status: 'accepted',
            }
        const msLeft = Date.parse(body.expiresAt) - Date.now()
        if (msLeft <= 0) {
            await this.deliveries.record(key, 'auth.code', 'skipped', 'expired before sending')
            return {
                status: 'failed',
            }
        }
        try {
            await this.transport.send({
                to: body.email,
                ...render('auth.code', body.locale, {
                    code: body.code,
                    minutes: Math.max(1, Math.round(msLeft / 60_000)),
                }),
            })
            await this.deliveries.record(key, 'auth.code', 'accepted')
            return {
                status: 'accepted',
            }
        } catch (error) {
            this.logger.warn(
                {
                    challengeId: body.challengeId,
                    transport: this.config.transport,
                    err: redact((error as Error).message),
                },
                'Sign-in code not accepted by the provider',
            )
            await this.deliveries.record(key, 'auth.code', 'failed', (error as Error).message)
            return {
                status: 'failed',
            }
        }
    }
}
