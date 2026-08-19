import { Schema } from 'mongoose'

import { softDeletePlugin } from '../plugins/softDeletePlugin'

export const applySoftDelete = (schema: Schema): void => {
    schema.plugin(softDeletePlugin)
}
