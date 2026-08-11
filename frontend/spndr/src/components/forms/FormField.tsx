import React from 'react'

interface FormFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    type?: 'text' | 'number' | 'date' | 'email'
    placeholder?: string
    required?: boolean
    disabled?: boolean
    min?: string
    max?: string
    step?: string
}

const FormField: React.FC<FormFieldProps> = ({
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
    required,
    disabled,
    min,
    max,
    step,
}) => (
    <div>
        <label className="text-[13px] text-slate-300">
            {label}
            {required && <span className="text-rose-400 ml-0.5">*</span>}
        </label>
        <div className="input-box mb-0 mt-1">
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                required={required}
                disabled={disabled}
                min={min}
                max={max}
                step={step}
                className="w-full bg-transparent outline-none placeholder:text-slate-500"
            />
        </div>
    </div>
)

interface TextAreaFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    rows?: number
}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({
    label,
    value,
    onChange,
    placeholder,
    disabled,
    rows = 3,
}) => (
    <div>
        <label className="text-[13px] text-slate-300">{label}</label>
        <div className="input-box mb-0 mt-1 items-start">
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                rows={rows}
                className="w-full bg-transparent outline-none placeholder:text-slate-500 resize-none"
            />
        </div>
    </div>
)

export default FormField
