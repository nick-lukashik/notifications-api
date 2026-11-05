import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { inArray, lt, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { deliveries } from '../db/schema.js'
import type { Db } from '../db/types.js'

const HOUR_MS = 3_600_000

/**
 * A record of an email: 90 days after its last attempt. The privacy policy quotes
 * this period: change them together. Past it, a dead letter replayed by hand
 * would send its welcome or receipt email again.
 */
export const DELIVERY_RETENTION_MS = 90 * 24 * HOUR_MS

const PASS_INTERVAL_MS = HOUR_MS
/** The first pass, soon after start: a pod may not live an hour. */
const FIRST_PASS_DELAY_MS = 60_000
/** Rows per statement, well within the statement budget. */
export const BATCH_SIZE = 1_000
/** `pg_try_advisory_xact_lock(hashtext(...))`, taken per batch: one replica deletes at a time. */
export const RETENTION_LOCK = 'notifications-api:retention'

/**
 * Deletes records of emails past their retention: hourly on every replica. Every
 * batch commits by itself under an advisory lock. A replica that finds the lock
 * taken stops: the rest goes in the other replica's pass or the next hourly one.
 */
@Injectable()
export class DeliveryRetention implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly logger = new Logger('DeliveryRetention')
    private timer: NodeJS.Timeout | undefined
    private running: Promise<void> | undefined
    private stopped = false

    constructor(@Inject(DB) private readonly db: Db) {}

    onApplicationBootstrap() {
        this.schedule(FIRST_PASS_DELAY_MS)
    }

    async beforeApplicationShutdown() {
        this.stopped = true
        clearTimeout(this.timer)
        await this.running
    }

    /** One pass as of `now`: the rows it deleted, or null when another replica holds the lock at the start. */
    async purge(now: Date): Promise<number | null> {
        const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_MS)
        let purged: number | null = null
        // Until a batch comes back short; a shutdown stops between batches.
        for (;;) {
            const count = await this.deleteBatch(cutoff)
            if (count === null) return purged
            purged = (purged ?? 0) + count
            if (this.stopped || count < BATCH_SIZE) return purged
        }
    }

    /** One batch, committed by itself: the rows it deleted, or null when another replica holds the lock. */
    private deleteBatch(cutoff: Date) {
        return this.db.transaction(async tx => {
            const { rows } = await tx.execute<{
                locked: boolean
            }>(sql`select pg_try_advisory_xact_lock(hashtext(${RETENTION_LOCK})) as locked`)
            if (!rows[0]?.locked) return null
            const deleted = await tx.delete(deliveries).where(
                inArray(
                    deliveries.id,
                    tx
                        .select({
                            id: deliveries.id,
                        })
                        .from(deliveries)
                        .where(lt(deliveries.updatedAt, cutoff))
                        .limit(BATCH_SIZE),
                ),
            )
            return deleted.rowCount ?? 0
        })
    }

    private schedule(delayMs: number) {
        if (this.stopped) return
        this.timer = setTimeout(() => {
            this.running = this.pass().finally(() => {
                this.running = undefined
                this.schedule(PASS_INTERVAL_MS)
            })
        }, delayMs)
    }

    private async pass() {
        try {
            const purged = await this.purge(new Date())
            if (purged)
                this.logger.log(
                    {
                        purged,
                    },
                    'Expired records of emails deleted',
                )
        } catch (error) {
            this.logger.error(
                {
                    err: (error as Error).message,
                },
                'Retention pass failed',
            )
        }
    }
}
