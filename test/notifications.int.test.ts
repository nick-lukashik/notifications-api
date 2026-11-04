import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventsConsumer } from '../src/events/events.consumer.js'
import { EMAIL_QUEUE, EmailJobs } from '../src/mail/email.job.js'
import { INTERNAL_TOKEN, startApp, type TestApp } from './harness.js'
import { type Identity, startIdentity } from './identity.js'

let identity: Identity
let t: TestApp

beforeAll(async () => {
    identity = await startIdentity()
    t = await startApp(identity)
})
afterAll(async () => {
    await t?.close()
    await identity?.close()
})

const envelope = (type: string, producer: string, payload: Record<string, unknown>) => ({
    eventId: randomUUID(),
    type,
    producer,
    occurredAt: new Date().toISOString(),
    aggregateId: randomUUID(),
    payload,
})

describe('sign-in codes', () => {
    const body = (overrides: Record<string, unknown> = {}) => ({
        challengeId: randomUUID(),
        email: 'anna@example.com',
        code: '482913',
        locale: 'ru',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        ...overrides,
    })

    it('needs the service token', async () => {
        await t.http().post('/api/v1/internal/auth-codes').send(body()).expect(401)
    })

    it('sends the code once and keeps neither the code nor the address', async () => {
        const message = body()
        const first = await t
            .http()
            .post('/api/v1/internal/auth-codes')
            .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
            .send(message)
            .expect(200)
        expect(first.body).toEqual({
            status: 'accepted',
        })
        await t
            .http()
            .post('/api/v1/internal/auth-codes')
            .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
            .send(message)
            .expect(200)
        const sent = t.mail.sent.filter(mail => mail.subject.includes('482913'))
        expect(sent).toHaveLength(1)
        expect(sent[0]?.to).toBe('anna@example.com')
        expect(sent[0]?.text).toContain('482913')

        const dump = await t.db.execute(sql`select row_to_json(d)::text as row from deliveries d`)
        const text = JSON.stringify(dump.rows)
        expect(text).toContain(`auth-code:${message.challengeId}`)
        expect(text).not.toContain('482913')
        expect(text).not.toContain('anna@example.com')
    })

    it('does not send an expired code and reports a provider failure without the address', async () => {
        const expired = await t
            .http()
            .post('/api/v1/internal/auth-codes')
            .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
            .send(
                body({
                    expiresAt: new Date(Date.now() - 1_000).toISOString(),
                }),
            )
            .expect(200)
        expect(expired.body.status).toBe('failed')

        t.mail.fail = true
        try {
            const failed = await t
                .http()
                .post('/api/v1/internal/auth-codes')
                .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
                .send(body())
                .expect(200)
            expect(failed.body.status).toBe('failed')
        } finally {
            t.mail.fail = false
        }
        const errors = await t.db.execute<{
            last_error: string
        }>(sql`select last_error from deliveries where status = 'failed'`)
        expect(errors.rows[0]?.last_error).toContain('<address>')
        expect(JSON.stringify(errors.rows)).not.toContain('someone@example.com')
    })
})

describe('events and the inbox', () => {
    it('turns a wallet credit into one inbox entry the owner can read', async () => {
        const userId = randomUUID()
        const consumer = t.app.get(EventsConsumer)
        const event = envelope('wallet.credit.posted.v1', 'wallet', {
            txId: randomUUID(),
            userId,
            unit: 'COIN',
            amount: '500',
            balanceAfter: '500',
            source: 'pay',
            ref: 'pack:payment:1',
            createdAt: new Date().toISOString(),
        })
        await expect(consumer.handle(event)).resolves.toBe('processed')
        await expect(consumer.handle(event)).resolves.toBe('duplicate')

        const token = await identity.token(userId)
        const inbox = await t.http().get('/api/v1/me/notifications').set('authorization', `Bearer ${token}`).expect(200)
        expect(inbox.body.unreadCount).toBe(1)
        expect(inbox.body.items[0]).toMatchObject({
            kind: 'wallet.credited',
            params: {
                amount: '500',
            },
            read: false,
        })

        // Someone else's entry does not exist for the caller.
        const stranger = await identity.token(randomUUID())
        await t
            .http()
            .post(`/api/v1/me/notifications/${inbox.body.items[0].id}/read`)
            .set('authorization', `Bearer ${stranger}`)
            .expect(404)
        await t
            .http()
            .post(`/api/v1/me/notifications/${inbox.body.items[0].id}/read`)
            .set('authorization', `Bearer ${token}`)
            .expect(204)
        const after = await t.http().get('/api/v1/me/notifications').set('authorization', `Bearer ${token}`).expect(200)
        expect(after.body.unreadCount).toBe(0)
    })

    it('queues a receipt for a payment and sends it to the address from id-api', async () => {
        const userId = randomUUID()
        identity.users.set(userId, {
            id: userId,
            email: 'buyer@example.com',
            locale: 'en',
            status: 'active',
        })
        const paymentId = randomUUID()
        await t.app.get(EventsConsumer).handle(
            envelope('pay.payment.succeeded.v1', 'pay', {
                paymentId,
                userId,
                productKey: 'coins-550',
                coins: '550',
                amount: '500',
                currency: 'RUB',
                provider: 'fake',
                paidAt: new Date().toISOString(),
            }),
        )
        const queued = await t.db.execute<{
            data: {
                key: string
            }
        }>(sql`select data from pgboss.job where name = ${EMAIL_QUEUE}`)
        const job = queued.rows.find(row => row.data.key === `receipt:${paymentId}`)
        expect(job).toBeDefined()

        await t.app.get(EmailJobs).send(job?.data as never)
        const receipt = t.mail.sent.at(-1)
        expect(receipt?.to).toBe('buyer@example.com')
        expect(receipt?.subject).toBe('Payment received: 550 coins')
    })

    it('refuses the inbox without a valid token', async () => {
        await t.http().get('/api/v1/me/notifications').expect(401)
    })
})
