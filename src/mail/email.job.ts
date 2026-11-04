import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { sql } from 'drizzle-orm'
import { fromDrizzle, type JobWithMetadata, PgBoss } from 'pg-boss'
import { PG_BOSS } from '../common/jobs/jobs.module.js'
import { Metrics } from '../common/metrics/metrics.js'
import { mailConfig } from '../config/config.js'
import type { Tx } from '../db/types.js'
import { IdClient } from '../users/id-client.js'
import { Deliveries, redact } from './deliveries.js'
import { MailTransport } from './mail-transport.js'
import { render } from './templates.js'

export const EMAIL_QUEUE = 'notifications.email'

export type EmailJob =
    | {
          key: string
          template: 'welcome'
          userId: string
      }
    | {
          key: string
          template: 'receipt'
          userId: string
          coins: string
          amount: string
          currency: string
      }

/** The `template` label of emails_failed_total. */
const TEMPLATES = [
    'welcome',
    'receipt',
] as const satisfies readonly EmailJob['template'][]

/**
 * Emails caused by events, sent outside the event's transaction with retries
 * (pg-boss): the consumer only queues the job. The address and language come
 * from id-api at send time; a suspended or missing user gets nothing.
 */
@Injectable()
export class EmailJobs implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger('EmailJobs')
    private readonly failures

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        @Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>,
        private readonly users: IdClient,
        private readonly transport: MailTransport,
        private readonly deliveries: Deliveries,
        metrics: Metrics,
    ) {
        this.failures = metrics.counter({
            name: 'emails_failed_total',
            help: 'Email jobs failed for good (their last retry failed too), by template.',
            labelNames: [
                'template',
            ],
        })
        // Every series from the start, so a first failure is an increase Prometheus can see.
        for (const template of TEMPLATES)
            this.failures.inc(
                {
                    template,
                },
                0,
            )
    }

    async onModuleInit() {
        await this.boss.createQueue(EMAIL_QUEUE, {
            retryLimit: 8,
            retryDelay: 30,
            retryBackoff: true,
            expireInSeconds: 60,
        })
    }

    async onApplicationBootstrap() {
        await this.boss.work(
            EMAIL_QUEUE,
            {
                pollingIntervalSeconds: 2,
                // retryLimit of the job: whether this attempt is its last.
                includeMetadata: true,
            },
            async ([job]: JobWithMetadata<EmailJob>[]) => {
                if (!job) return
                // pg-boss retries while retryCount < retryLimit, then fails the job for good.
                const lastAttempt = job.retryCount >= job.retryLimit
                try {
                    await this.send(job.data, lastAttempt)
                } catch (error) {
                    // Not counted: a last attempt that pg-boss expires (expireInSeconds) never gets here.
                    if (lastAttempt)
                        this.failures.inc({
                            template: job.data.template,
                        })
                    throw error
                }
            },
        )
    }

    /** Queues an email that commits or rolls back with `tx`. */
    async enqueue(tx: Tx, job: EmailJob) {
        await this.boss.send(EMAIL_QUEUE, job, {
            db: fromDrizzle(tx, sql),
            singletonKey: job.key,
        })
    }

    async send(job: EmailJob, lastAttempt = false) {
        if (await this.deliveries.alreadyAccepted(job.key)) return
        const user = await this.users.recipient(job.userId)
        if (!user || user.status !== 'active') {
            await this.deliveries.record(job.key, job.template, 'skipped', 'no active user')
            return
        }
        const message =
            job.template === 'welcome'
                ? render('welcome', user.locale, {
                      idWebUrl: this.config.idWebUrl,
                  })
                : render('receipt', user.locale, {
                      coins: job.coins,
                      amount: job.amount,
                      currency: job.currency,
                      idWebUrl: this.config.idWebUrl,
                  })
        try {
            await this.transport.send({
                to: user.email,
                ...message,
            })
        } catch (error) {
            const reason = redact((error as Error).message)
            await this.deliveries.record(job.key, job.template, 'failed', reason)
            this.logger.warn(
                {
                    key: job.key,
                    err: reason,
                },
                lastAttempt
                    ? 'Email not accepted on the last attempt, pg-boss fails the job'
                    : 'Email not accepted, pg-boss retries',
            )
            throw new Error(reason)
        }
        await this.deliveries.record(job.key, job.template, 'accepted')
    }
}
