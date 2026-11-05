import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import nodemailer, { type Transporter } from 'nodemailer'
import { mailConfig } from '../config/config.js'

export type MailMessage = {
    to: string
    subject: string
    text: string
}

/** Hands one email to the provider; `accepted` means the provider took it, not that it arrived. */
export abstract class MailTransport {
    abstract send(message: MailMessage): Promise<void>
}

/** SMTP with time budgets: 5 s to connect, 5 s per reply. */
@Injectable()
export class SmtpTransport extends MailTransport implements OnApplicationShutdown {
    private readonly transporter: Transporter

    constructor(@Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>) {
        super()
        // smtp://user:pass@host:587 (STARTTLS) or smtps://user:pass@host:465.
        const url = new URL(config.smtpUrl ?? 'smtp://localhost:25')
        this.transporter = nodemailer.createTransport({
            host: url.hostname,
            port: Number(url.port || (url.protocol === 'smtps:' ? 465 : 587)),
            secure: url.protocol === 'smtps:',
            requireTLS: url.protocol === 'smtp:' && url.hostname !== 'localhost',
            auth: url.username
                ? {
                      user: decodeURIComponent(url.username),
                      pass: decodeURIComponent(url.password),
                  }
                : undefined,
            connectionTimeout: 5_000,
            greetingTimeout: 5_000,
            socketTimeout: 5_000,
        })
    }

    async send(message: MailMessage) {
        await this.transporter.sendMail({
            from: this.config.from,
            ...message,
        })
    }

    onApplicationShutdown() {
        this.transporter.close()
    }
}

/** No provider (local runs, stage without mail): logs that an email was dropped, nothing of it. A sign-in code is in the subject. */
@Injectable()
export class LogTransport extends MailTransport {
    private readonly logger = new Logger('Mail')

    async send(_message: MailMessage) {
        this.logger.log('Email not sent: MAIL_TRANSPORT=log')
    }
}
