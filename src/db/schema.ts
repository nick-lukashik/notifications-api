import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

// Platform tables every service with events carries: outbox and inbox.
export { inbox, outbox } from '../common/messaging/outbox.schema.js'

/** Millisecond precision, so an ISO string from JSON round-trips exactly (cursors). */
const at = (name: string) =>
    timestamp(name, {
        withTimezone: true,
        precision: 3,
    })

/** The in-app inbox: what a person sees on id-web. Text is rendered there from `kind` and `params`. */
export const notifications = pgTable(
    'notifications',
    {
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        userId: uuid('user_id').notNull(),
        kind: text('kind', {
            enum: [
                'wallet.credited',
                'welcome',
            ],
        }).notNull(),
        params: jsonb('params').$type<Record<string, string>>().notNull(),
        /** The event it came from: one entry per event. */
        sourceEventId: uuid('source_event_id').notNull(),
        readAt: at('read_at'),
        createdAt: at('created_at').notNull().defaultNow(),
    },
    t => [
        uniqueIndex('notifications_source_event_uq').on(t.sourceEventId, t.kind),
        index('notifications_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
        index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
    ],
)

/**
 * Every email handed to the provider, by idempotency key (`auth-code:<challengeId>`,
 * `welcome:<userId>`, `receipt:<paymentId>`). Never the code, the address or the body.
 */
export const deliveries = pgTable(
    'deliveries',
    {
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        idempotencyKey: text('idempotency_key').notNull(),
        template: text('template').notNull(),
        status: text('status', {
            enum: [
                'accepted',
                'failed',
                'skipped',
            ],
        }).notNull(),
        attempts: integer('attempts').notNull().default(1),
        lastError: text('last_error'),
        createdAt: at('created_at').notNull().defaultNow(),
        updatedAt: at('updated_at').notNull().defaultNow(),
    },
    t => [
        uniqueIndex('deliveries_key_uq').on(t.idempotencyKey),
        check('deliveries_error_length', sql`char_length(${t.lastError}) <= 500`),
    ],
)
