import React from 'react'
import { CURRENCY_OPTIONS } from '../../utils/currencies'

interface CurrencySelectProps {
    label?: string
    value: string
    onChange: (value: string) => void
    required?: boolean
    disabled?: boolean
    className?: string
}

const CurrencySelect: React.FC<CurrencySelectProps> = ({
    label = 'Currency',
    value,
    onChange,
    required,
    disabled,
    className,
}) => (
    <div className={className}>
        <label className="text-[13px] text-slate-300">
            {label}
            {required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                required={required}
                disabled={disabled}
                className="w-full bg-transparent outline-none text-slate-200"
            >
                {CURRENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

export default CurrencySelect
