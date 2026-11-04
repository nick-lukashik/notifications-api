import { Inject, Injectable } from '@nestjs/common'
import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import { cursorCodec } from '../common/http/cursor.js'
import { notifications } from '../db/schema.js'
import type { Db, Tx } from '../db/types.js'

const cursor = cursorCodec(
    z.object({
        createdAt: z.iso.datetime(),
        id: z.uuid(),
    }),
)

export type NewNotification = {
    userId: string
    kind: 'wallet.credited' | 'welcome'
    params: Record<string, string>
    sourceEventId: string
}

/** The in-app inbox. Every query filters by the owner: someone else's entry is 404. */
@Injectable()
export class NotificationsService {
    constructor(@Inject(DB) private readonly db: Db) {}

    /** In the inbox transaction of the event; one entry per event and kind. */
    async add(tx: Tx, entry: NewNotification) {
        await tx.insert(notifications).values(entry).onConflictDoNothing()
    }

    async list(userId: string, limit: number, from?: string) {
        const after = from ? cursor.decode(from) : undefined
        const rows = await this.db
            .select()
            .from(notifications)
            .where(
                and(
                    eq(notifications.userId, userId),
                    after
                        ? or(
                              lt(notifications.createdAt, new Date(after.createdAt)),
                              and(
                                  eq(notifications.createdAt, new Date(after.createdAt)),
                                  lt(notifications.id, after.id),
                              ),
                          )
                        : undefined,
                ),
            )
            .orderBy(desc(notifications.createdAt), desc(notifications.id))
            .limit(limit + 1)
        const page = rows.slice(0, limit)
        const last = page.at(-1)
        const [unread] = await this.db
            .select({
                value: count(),
            })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        return {
            items: page.map(row => ({
                id: row.id,
                kind: row.kind,
                params: row.params,
                read: row.readAt !== null,
                createdAt: row.createdAt.toISOString(),
            })),
            nextCursor:
                rows.length > limit && last
                    ? cursor.encode({
                          createdAt: last.createdAt.toISOString(),
                          id: last.id,
                      })
                    : null,
            unreadCount: unread?.value ?? 0,
        }
    }

    async markRead(userId: string, id: string) {
        const updated = await this.db
            .update(notifications)
            .set({
                readAt: new Date(),
            })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning({
                id: notifications.id,
            })
        if (updated.length === 0) throw notFound('Notification')
    }

    async markAllRead(userId: string) {
        const updated = await this.db
            .update(notifications)
            .set({
                readAt: new Date(),
            })
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
            .returning({
                id: notifications.id,
            })
        return updated.length
    }
}
