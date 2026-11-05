import { Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { AuthCodesController } from './codes/auth-codes.controller.js'
import { mailConfig } from './config/config.js'
import { EventsConsumer } from './events/events.consumer.js'
import { MeNotificationsController } from './inbox/me.controller.js'
import { NotificationsService } from './inbox/notifications.service.js'
import { Deliveries } from './mail/deliveries.js'
import { DeliveryRetention } from './mail/delivery-retention.js'
import { EmailJobs } from './mail/email.job.js'
import { LogTransport, MailTransport, SmtpTransport } from './mail/mail-transport.js'
import { IdClient } from './users/id-client.js'

@Module({
    controllers: [
        AuthCodesController,
        MeNotificationsController,
    ],
    providers: [
        {
            provide: MailTransport,
            inject: [
                mailConfig.KEY,
            ],
            useFactory: (config: ConfigType<typeof mailConfig>) =>
                config.transport === 'smtp' ? new SmtpTransport(config) : new LogTransport(),
        },
        Deliveries,
        DeliveryRetention,
        EmailJobs,
        EventsConsumer,
        IdClient,
        NotificationsService,
    ],
})
export class NotificationsModule {}
