import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import { applySoftDelete } from '@core/softDelete/applySoftDelete'

import {
    CUSTOM_REPORT_CHART_TYPES,
    CUSTOM_REPORT_DATA_TYPES,
    CUSTOM_REPORT_SPLIT_BY,
    REPORT_PERIOD_TYPES,
    type CustomReportChartType,
    type CustomReportDataType,
    type CustomReportSplitBy,
    type ReportPeriodType,
} from './reportUtils'
import { DASHBOARD_GROUP_BY_VALUES, type DashboardGroupBy } from '@modules/dashboard/dashboardUtils'

export interface ISavedReportConfig {
    periodType: ReportPeriodType
    year?: number
    month?: number
    startDate?: string
    endDate?: string
    splitBy: CustomReportSplitBy
    chartType: CustomReportChartType
    dataType: CustomReportDataType
    groupBy?: DashboardGroupBy
}

export interface ISavedReport extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name: string
    config: ISavedReportConfig
    /** See `Transaction.createdByRemovedUser` - same meaning, same sentinel `userId`. */
    createdByRemovedUser?: boolean
    deletedAt?: Date | null
    createdAt: Date
    updatedAt: Date
}

const SavedReportConfigSchema = new Schema<ISavedReportConfig>(
    {
        periodType: { type: String, enum: REPORT_PERIOD_TYPES, required: true },
        year: { type: Number },
        month: { type: Number },
        startDate: { type: String },
        endDate: { type: String },
        splitBy: { type: String, enum: CUSTOM_REPORT_SPLIT_BY, required: true },
        chartType: { type: String, enum: CUSTOM_REPORT_CHART_TYPES, required: true },
        dataType: { type: String, enum: CUSTOM_REPORT_DATA_TYPES, required: true },
        groupBy: { type: String, enum: DASHBOARD_GROUP_BY_VALUES },
    },
    { _id: false }
)

const SavedReportSchema = new Schema<ISavedReport>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        name: { type: String, required: true, trim: true },
        config: { type: SavedReportConfigSchema, required: true },
        createdByRemovedUser: { type: Boolean, default: false },
    },
    { timestamps: true }
)

SavedReportSchema.index({ userId: 1, updatedAt: -1 })
SavedReportSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
SavedReportSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(SavedReportSchema, { supportsWorkspace: true })
applySoftDelete(SavedReportSchema)

const SavedReport: Model<ISavedReport> = mongoose.model<ISavedReport>(
    'SavedReport',
    SavedReportSchema
)
export default SavedReport
