import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogTransport } from './mail-transport.js'

describe('LogTransport', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('logs nothing of the email: the sign-in code is in the subject', async () => {
        const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
        await new LogTransport().send({
            to: 'someone@example.com',
            subject: '123456 is your sign-in code',
            text: 'Your sign-in code: 123456',
        })
        expect(log).toHaveBeenCalledOnce()
        const logged = JSON.stringify(log.mock.calls)
        expect(logged).not.toContain('123456')
        expect(logged).not.toContain('someone@example.com')
    })
})
