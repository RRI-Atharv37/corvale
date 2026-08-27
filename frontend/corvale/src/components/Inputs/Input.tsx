import React, { useId, useState } from 'react'
import { FaRegEye, FaRegEyeSlash } from 'react-icons/fa6'

interface InputProps {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder: string
    label: string
    type: 'text' | 'password' | 'email'
    disabled?: boolean
}

const Input: React.FC<InputProps> = ({ value, onChange, placeholder, label, type, disabled }) => {
    const [showPassword, setShowPassword] = useState(false)
    const toggleShowPassword = () => setShowPassword((prev) => !prev)
    const inputId = useId()

    return (
        <div>
            <label htmlFor={inputId} className="text-[13px] text-fg-secondary">{label}</label>

            <div className="input-box">
                <input
                    id={inputId}
                    type={type === 'password' ? (showPassword ? 'text' : 'password') : type}
                    placeholder={placeholder}
                    className="w-full bg-transparent outline-none placeholder:text-fg-muted"
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                />

                {type === 'password' && (
                    <button
                        type="button"
                        onClick={toggleShowPassword}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="shrink-0 bg-transparent border-0 p-0"
                    >
                        {showPassword ? (
                            <FaRegEye size={20} className="text-accent" />
                        ) : (
                            <FaRegEyeSlash size={20} className="text-fg-muted" />
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}

export default Input
