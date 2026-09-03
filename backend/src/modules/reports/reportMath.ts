export const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100
