import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { deliveries } from '../db/schema.js'
import type { Db } from '../db/types.js'

export type DeliveryStatus = 'accepted' | 'failed' | 'skipped'

/** Provider errors may quote the recipient: addresses never reach a table or a log. */
export const redact = (message: string) => message.replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '<address>').slice(0, 500)

/** The ledger of emails by idempotency key: a repeated key is not sent twice once accepted. */
@Injectable()
export class Deliveries {
    constructor(@Inject(DB) private readonly db: Db) {}

    async alreadyAccepted(key: string) {
        const [row] = await this.db
            .select({
                status: deliveries.status,
            })
            .from(deliveries)
            .where(eq(deliveries.idempotencyKey, key))
        return row?.status === 'accepted'
    }

    async record(key: string, template: string, status: DeliveryStatus, error?: string) {
        await this.db
            .insert(deliveries)
            .values({
                idempotencyKey: key,
                template,
                status,
                lastError: error === undefined ? undefined : redact(error),
            })
            .onConflictDoUpdate({
                target: deliveries.idempotencyKey,
                set: {
                    status,
                    lastError: error === undefined ? null : redact(error),
                    attempts: sql`${deliveries.attempts} + 1`,
                    updatedAt: new Date(),
                },
            })
    }
}
