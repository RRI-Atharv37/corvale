import { Schema } from 'mongoose'

import { rowLevelSecurityPlugin } from '../plugins/rowLevelSecurityPlugin'
import { RlsPluginOptions } from './rowLevelSecurity'

export const applyRowLevelSecurity = (schema: Schema, options: RlsPluginOptions = {}): void => {
    schema.plugin(rowLevelSecurityPlugin, options)
}
