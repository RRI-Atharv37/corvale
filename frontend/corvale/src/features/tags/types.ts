export interface Tag {
    _id: string
    userId: string
    name: string
    color?: string
    createdAt?: string
    updatedAt?: string
}

export interface TagFormData {
    name: string
    color: string
}
