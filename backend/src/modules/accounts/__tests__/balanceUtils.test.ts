import { describe, it, expect } from 'vitest'
import { roundMoney } from "@shared/money";

describe('balanceUtils', () => {
    it('roundMoney handles floating-point precision', () => {
        expect(roundMoney(0.1 + 0.2)).toBe(0.3)
        expect(roundMoney(10.005)).toBe(10.01)
        expect(roundMoney(10.004)).toBe(10)
    })
})
