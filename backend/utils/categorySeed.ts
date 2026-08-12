import Category from '../models/Category'

export const MASTER_CATEGORY_DEFINITIONS = [
    { name: 'Food', icon: 'utensils', color: '#EF4444', sortOrder: 0 },
    { name: 'Transport', icon: 'car', color: '#3B82F6', sortOrder: 1 },
    { name: 'Entertainment', icon: 'film', color: '#A855F7', sortOrder: 2 },
    { name: 'Housing', icon: 'home', color: '#F97316', sortOrder: 3 },
    { name: 'Education', icon: 'book', color: '#06B6D4', sortOrder: 4 },
    { name: 'Health', icon: 'heart', color: '#EC4899', sortOrder: 5 },
    { name: 'Shopping', icon: 'shopping-bag', color: '#EAB308', sortOrder: 6 },
    { name: 'Income', icon: 'trending-up', color: '#22C55E', sortOrder: 7 },
    { name: 'Other', icon: 'more-horizontal', color: '#6B7280', sortOrder: 8 },
] as const

export const ensureMasterCategoriesSeeded = async (): Promise<void> => {
    for (const definition of MASTER_CATEGORY_DEFINITIONS) {
        await Category.findOneAndUpdate(
            { userId: null, name: definition.name },
            {
                $setOnInsert: {
                    userId: null,
                    masterCategoryId: null,
                    name: definition.name,
                    icon: definition.icon,
                    color: definition.color,
                    sortOrder: definition.sortOrder,
                    isDefault: false,
                    isArchived: false,
                },
            },
            { upsert: true, new: true }
        )
    }
}

export const isMasterCategory = (category: { userId: unknown; masterCategoryId: unknown }): boolean => {
    return category.userId == null && category.masterCategoryId == null
}
