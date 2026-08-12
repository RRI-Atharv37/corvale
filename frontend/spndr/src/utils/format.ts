export const formatCurrency = (amount: number, currency = 'USD'): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

export const toDateInputValue = (date: string | Date): string => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toISOString().split('T')[0]
}
