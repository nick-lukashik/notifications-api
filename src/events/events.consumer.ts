import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { paymentSucceededV1, userRegisteredV1, walletCreditedV1 } from '@nick-lukashik/contracts'
import { DB } from '../common/database/database.js'
import { defineEvent, type Envelope } from '../common/messaging/event.js'
import { processOnce } from '../common/messaging/inbox.js'
import { PermanentError, RabbitMq } from '../common/messaging/rabbitmq.js'
import { defineQueue } from '../common/messaging/topology.js'
import type { Db, Tx } from '../db/types.js'
import { NotificationsService } from '../inbox/notifications.service.js'
import { EmailJobs } from '../mail/email.job.js'

const userRegistered = defineEvent(userRegisteredV1.type, userRegisteredV1.producer, userRegisteredV1.payload)
const paymentSucceeded = defineEvent(paymentSucceededV1.type, paymentSucceededV1.producer, paymentSucceededV1.payload)
const walletCredited = defineEvent(walletCreditedV1.type, walletCreditedV1.producer, walletCreditedV1.payload)

/** This service's queue, bound to the events that make a notification. */
export const notificationsQueue = defineQueue('notifications-api.events', [
    {
        producer: userRegistered.producer,
        types: [
            userRegistered.type,
        ],
    },
    {
        producer: paymentSucceeded.producer,
        types: [
            paymentSucceeded.type,
        ],
    },
    {
        producer: walletCredited.producer,
        types: [
            walletCredited.type,
        ],
    },
])

/**
 * Events → the inbox entry and the email job, in the inbox transaction of the
 * event: a redelivered event changes nothing, a rolled-back one queues nothing.
 */
@Injectable()
export class EventsConsumer implements OnApplicationBootstrap {
    private readonly logger = new Logger('EventsConsumer')

    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly rabbit: RabbitMq,
        private readonly notifications: NotificationsService,
        private readonly emails: EmailJobs,
    ) {}

    async onApplicationBootstrap() {
        await this.rabbit.subscribe(notificationsQueue, async event => {
            await this.handle(event)
        })
    }

    async handle(envelope: Envelope): Promise<'processed' | 'duplicate'> {
        const effect = this.effectOf(envelope)
        const outcome = await processOnce(
            this.db,
            {
                consumer: notificationsQueue.name,
                eventId: envelope.eventId,
                type: envelope.type,
            },
            effect,
        )
        if (outcome === 'duplicate')
            this.logger.log(
                {
                    eventId: envelope.eventId,
                },
                'Duplicate event ignored',
            )
        return outcome
    }

    private effectOf(envelope: Envelope): (tx: Tx) => Promise<void> {
        const parse = <
            S extends {
                safeParse: (value: unknown) => {
                    success: boolean
                    data?: unknown
                }
            },
        >(
            schema: S,
        ) => {
            const result = schema.safeParse(envelope)
            if (!result.success) throw new PermanentError(`invalid ${envelope.type}`)
            return result.data as Envelope & {
                payload: never
            }
        }
        switch (envelope.type) {
            case userRegistered.type: {
                const event = userRegistered.parse(parse(userRegistered.schema))
                return tx =>
                    this.emails.enqueue(tx, {
                        key: `welcome:${event.payload.userId}`,
                        template: 'welcome',
                        userId: event.payload.userId,
                    })
            }
            case paymentSucceeded.type: {
                const event = paymentSucceeded.parse(parse(paymentSucceeded.schema))
                return tx =>
                    this.emails.enqueue(tx, {
                        key: `receipt:${event.payload.paymentId}`,
                        template: 'receipt',
                        userId: event.payload.userId,
                        coins: event.payload.coins,
                        amount: event.payload.amount,
                        currency: event.payload.currency,
                    })
            }
            case walletCredited.type: {
                const event = walletCredited.parse(parse(walletCredited.schema))
                return tx =>
                    this.notifications.add(tx, {
                        userId: event.payload.userId,
                        kind: 'wallet.credited',
                        params: {
                            amount: event.payload.amount,
                            balanceAfter: event.payload.balanceAfter,
                            source: event.payload.source,
                        },
                        sourceEventId: event.eventId,
                    })
            }
            default:
                throw new PermanentError(`unexpected event type ${envelope.type}`)
        }
    }
}
