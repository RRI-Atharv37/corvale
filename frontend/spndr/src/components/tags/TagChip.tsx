import React from 'react'
import { IoClose } from 'react-icons/io5'

const DEFAULT_TAG_COLOR = '#6b7280'

export interface TagChipProps {
    name: string
    color?: string
    onRemove?: () => void
    size?: 'sm' | 'md'
}

const TagChip: React.FC<TagChipProps> = ({ name, color, onRemove, size = 'sm' }) => {
    const chipColor = color ?? DEFAULT_TAG_COLOR
    const sizeClasses = size === 'md' ? 'text-xs px-2.5 py-1' : 'text-[11px] px-2 py-0.5'

    return (
        <span
            className={[
                'inline-flex items-center gap-1 rounded-full border font-medium',
                sizeClasses,
            ].join(' ')}
            style={{
                borderColor: `${chipColor}55`,
                backgroundColor: `${chipColor}18`,
                color: chipColor,
            }}
        >
            <span className="truncate max-w-[140px]">{name}</span>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded-full p-0.5 hover:bg-white/10 transition-colors"
                    aria-label={`Remove ${name}`}
                >
                    <IoClose size={size === 'md' ? 14 : 12} />
                </button>
            )}
        </span>
    )
}

export default TagChip
