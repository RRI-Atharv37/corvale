import React, { useState } from 'react'
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

    return (
        <div>
            <label className="text-[13px] text-fg-secondary">{label}</label>

            <div className="input-box">
                <input
                    type={type === 'password' ? (showPassword ? 'text' : 'password') : type}
                    placeholder={placeholder}
                    className="w-full bg-transparent outline-none placeholder:text-fg-muted"
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                />

                {type === 'password' && (
                    <>
                        {showPassword ? (
                            <FaRegEye
                                size={20}
                                className="text-accent cursor-pointer shrink-0"
                                onClick={toggleShowPassword}
                            />
                        ) : (
                            <FaRegEyeSlash
                                size={20}
                                className="text-fg-muted cursor-pointer shrink-0"
                                onClick={toggleShowPassword}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default Input
