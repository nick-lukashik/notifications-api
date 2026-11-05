import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PG_POOL } from '../src/common/database/database.js'
import { deliveries } from '../src/db/schema.js'
import { BATCH_SIZE, DELIVERY_RETENTION_MS, DeliveryRetention, RETENTION_LOCK } from '../src/mail/delivery-retention.js'
import { startApp, type TestApp } from './harness.js'
import { type Identity, startIdentity } from './identity.js'

const HOUR = 3_600_000

let identity: Identity
let t: TestApp
let retention: DeliveryRetention

beforeAll(async () => {
    identity = await startIdentity()
    t = await startApp(identity)
    retention = t.app.get(DeliveryRetention)
})
afterAll(async () => {
    await t?.close()
    await identity?.close()
})
afterEach(async () => {
    await t.db.delete(deliveries)
})

/** The clock of the passes. Every row is an hour off the cutoff, either way. */
const now = new Date()
const pastCutoff = new Date(now.getTime() - DELIVERY_RETENTION_MS - HOUR)
const withinCutoff = new Date(now.getTime() - DELIVERY_RETENTION_MS + HOUR)

async function delivery(createdAt: Date, updatedAt = createdAt) {
    const key = `welcome:${randomUUID()}`
    await t.db.insert(deliveries).values({
        idempotencyKey: key,
        template: 'welcome',
        status: 'accepted',
        createdAt,
        updatedAt,
    })
    return key
}

const exists = async (key: string) =>
    (await t.db.select().from(deliveries).where(eq(deliveries.idempotencyKey, key))).length === 1

describe('records of emails', () => {
    it('go 90 days after the last attempt, and the others stay', async () => {
        const old = await delivery(pastCutoff)
        const recent = await delivery(withinCutoff)
        const retried = await delivery(pastCutoff, withinCutoff)

        await expect(retention.purge(now)).resolves.toBe(1)

        expect(await exists(old)).toBe(false)
        expect(await exists(recent)).toBe(true)
        expect(await exists(retried)).toBe(true)
    })

    it('go in batches until none is left', async () => {
        await t.db.execute(sql`
            insert into deliveries (idempotency_key, template, status, created_at, updated_at)
            select 'welcome:' || n, 'welcome', 'accepted', ${pastCutoff}, ${pastCutoff}
            from generate_series(1, ${BATCH_SIZE + 5}) as n
        `)

        await expect(retention.purge(now)).resolves.toBe(BATCH_SIZE + 5)
        await expect(t.db.select().from(deliveries)).resolves.toEqual([])
    })

    it('stay while another replica holds the lock', async () => {
        const old = await delivery(pastCutoff)
        const client = await t.app.get<pg.Pool>(PG_POOL).connect()
        try {
            await client.query('begin')
            await client.query('select pg_advisory_xact_lock(hashtext($1))', [
                RETENTION_LOCK,
            ])

            await expect(retention.purge(now)).resolves.toBeNull()
            expect(await exists(old)).toBe(true)
        } finally {
            await client.query('rollback')
            client.release()
        }

        await expect(retention.purge(now)).resolves.toBe(1)
    })
})
