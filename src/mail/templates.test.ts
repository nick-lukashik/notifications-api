import { describe, expect, it } from 'vitest'
import { coinsText, render } from './templates.js'

describe('coinsText', () => {
    it('declines coins by the number', () => {
        expect(coinsText('1', 'en')).toBe('1 coin')
        expect(coinsText('550', 'en')).toBe('550 coins')
        expect(coinsText('1', 'ru')).toBe('1 монета')
        expect(coinsText('21', 'ru')).toBe('21 монета')
        expect(coinsText('2', 'ru')).toBe('2 монеты')
        expect(coinsText('550', 'ru')).toBe('550 монет')
        expect(coinsText('1200', 'ru')).toBe('1200 монет')
    })

    it('names the coins in the receipt', () => {
        const receipt = render('receipt', 'ru', {
            coins: '1200',
            amount: '1000',
            currency: 'RUB',
            idWebUrl: 'https://id.example.test',
        })
        expect(receipt.subject).toBe('Оплата получена: 1200 монет')
    })
})
