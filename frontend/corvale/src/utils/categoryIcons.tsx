import React from 'react'
import {
    FiBook,
    FiCoffee,
    FiFilm,
    FiHeart,
    FiHome,
    FiMoreHorizontal,
    FiShoppingBag,
    FiTrendingUp,
    FiTruck,
    FiTag,
    FiGift,
    FiBriefcase,
    FiSmartphone,
    FiZap,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'

export interface CategoryIconOption {
    value: string
    label: string
    Icon: IconType
}

export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
    { value: 'utensils', label: 'Food', Icon: FiCoffee },
    { value: 'car', label: 'Transport', Icon: FiTruck },
    { value: 'film', label: 'Entertainment', Icon: FiFilm },
    { value: 'home', label: 'Housing', Icon: FiHome },
    { value: 'book', label: 'Education', Icon: FiBook },
    { value: 'heart', label: 'Health', Icon: FiHeart },
    { value: 'shopping-bag', label: 'Shopping', Icon: FiShoppingBag },
    { value: 'trending-up', label: 'Income', Icon: FiTrendingUp },
    { value: 'more-horizontal', label: 'Other', Icon: FiMoreHorizontal },
    { value: 'tag', label: 'Tag', Icon: FiTag },
    { value: 'gift', label: 'Gift', Icon: FiGift },
    { value: 'briefcase', label: 'Work', Icon: FiBriefcase },
    { value: 'smartphone', label: 'Tech', Icon: FiSmartphone },
    { value: 'zap', label: 'Utilities', Icon: FiZap },
]

const iconMap = Object.fromEntries(CATEGORY_ICON_OPTIONS.map((option) => [option.value, option.Icon]))

export const getCategoryIcon = (icon?: string): IconType => {
    return iconMap[icon ?? ''] ?? FiMoreHorizontal
}

interface CategoryIconProps {
    icon?: string
    color?: string
    size?: number
    className?: string
}

export const CategoryIcon: React.FC<CategoryIconProps> = ({
    icon,
    color = '#94a3b8',
    size = 16,
    className,
}) => {
    const Icon = getCategoryIcon(icon)
    return <Icon size={size} style={{ color }} className={className} />
}

export const DEFAULT_CATEGORY_COLORS = [
    '#EF4444',
    '#F97316',
    '#EAB308',
    '#22C55E',
    '#06B6D4',
    '#3B82F6',
    '#A855F7',
    '#EC4899',
    '#6B7280',
]
