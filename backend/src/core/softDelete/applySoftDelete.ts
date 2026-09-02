import { Schema } from 'mongoose'

import { softDeletePlugin } from './softDeletePlugin'

export const applySoftDelete = (schema: Schema): void => {
    schema.plugin(softDeletePlugin)
}
