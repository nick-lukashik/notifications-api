import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PG_BOSS } from '../src/common/jobs/jobs.module.js'
import { EMAIL_QUEUE, type EmailJob } from '../src/mail/email.job.js'
import { startApp, type TestApp } from './harness.js'
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
afterEach(() => {
    t.mail.fail = false
})

/** Polls the job until pg-boss settles it as `state`. */
async function settled(id: string, state: string) {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
        const { rows } = await t.db.execute<{
            state: string
            retry_count: number
        }>(sql`select state, retry_count from pgboss.job where id = ${id}`)
        if (rows[0]?.state === state) return rows[0]
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`job ${id} did not become ${state}`)
}

describe('email jobs', () => {
    it('counts an email that failed for good once, after its last retry', async () => {
        const userId = randomUUID()
        identity.users.set(userId, {
            id: userId,
            email: 'anna@example.com',
            locale: 'en',
            status: 'active',
        })
        t.mail.fail = true
        const job: EmailJob = {
            key: `welcome:${userId}`,
            template: 'welcome',
            userId,
        }
        // The real worker: two attempts, the second one the last.
        const id = await t.app.get<PgBoss>(PG_BOSS).send(EMAIL_QUEUE, job, {
            retryLimit: 1,
            retryDelay: 0,
            retryBackoff: false,
        })
        if (!id) throw new Error('job not queued')

        const failed = await settled(id, 'failed')
        expect(failed.retry_count).toBe(1)
        expect(
            await t.metric('emails_failed_total', {
                template: 'welcome',
            }),
        ).toBe(1)
        expect(
            await t.metric('emails_failed_total', {
                template: 'receipt',
            }),
        ).toBe(0)
    })
})
