import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { queueDeclarations } from '../src/common/messaging/topology.js'
import { notificationsQueue } from '../src/events/events.consumer.js'

/**
 * A copy of gitops platform/data/stores/rabbitmq-topology.json, the file the
 * broker loads at boot. A change of this service's queues changes that file too.
 */
const topology = JSON.parse(readFileSync(new URL('./fixtures/rabbitmq-topology.json', import.meta.url), 'utf8')) as {
    exchanges: {
        name: string
        type: string
        durable: boolean
    }[]
    queues: {
        name: string
        durable: boolean
        arguments: Record<string, unknown>
    }[]
    bindings: {
        source: string
        destination: string
        routing_key: string
    }[]
}

describe('the broker definitions', () => {
    it('declare what this service declares', () => {
        const mine = topology.queues.filter(
            queue => queue.name === notificationsQueue.name || queue.name.startsWith(`${notificationsQueue.name}.`),
        )
        expect(
            mine.map(queue => ({
                name: queue.name,
                arguments: queue.arguments,
            })),
        ).toEqual(queueDeclarations(notificationsQueue))
        expect(mine.every(queue => queue.durable)).toBe(true)
        expect(
            topology.bindings
                .filter(binding => binding.destination === notificationsQueue.name)
                .map(binding => ({
                    exchange: binding.source,
                    routingKey: binding.routing_key,
                })),
        ).toEqual(notificationsQueue.bindings)
        for (const binding of notificationsQueue.bindings)
            expect(topology.exchanges).toContainEqual(
                expect.objectContaining({
                    name: binding.exchange,
                    type: 'topic',
                    durable: true,
                }),
            )
    })
})
