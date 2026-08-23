import Transaction from '../models/Transaction'
import Account from '../models/Account'
import Category from '../models/Category'
import Receipt from '../models/Receipt'
import Budget from '../models/Budget'
import SavingsGoal from '../models/SavingsGoal'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import RecurringRule from '../models/RecurringRule'
import Tag from '../models/Tag'
import CategorizationRule from '../models/CategorizationRule'
import TransactionTemplate from '../models/TransactionTemplate'
import Notification from '../models/Notification'
import Saver from '../models/Saver'
import Pushover from '../models/Pushover'
import ReconciliationSession from '../models/ReconciliationSession'
import SavedReport from '../models/SavedReport'
import Income from '../models/Income'
import Expense from '../models/Expense'
import Workspace from '../models/Workspace'
import User from '../models/User'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { revokeAllRefreshTokensForUser } from './refreshTokenService'
import { deleteReceiptFile } from './receiptUtils'
import { deleteReceiptObject, isObjectStorageConfigured, receiptObjectKey } from './receiptStorage'
import { SOFT_DELETE_BYPASS } from './softDelete'

const BYPASS_SOFT_DELETE = { [SOFT_DELETE_BYPASS]: true }

/**
 * Blocks account deletion (409) when the caller is the sole owner of a workspace that still
 * has other members - ownership must be transferred, or the workspace deleted, first, so
 * deleting one account can never silently orphan or destroy other members' shared data.
 */
export const assertAccountDeletionAllowed = async (userId: string): Promise<void> => {
    const ownedWorkspaces = await Workspace.find({ ownerId: userId })
    const hasOtherMembers = ownedWorkspaces.some((workspace) => workspace.members.length > 1)

    if (hasOtherMembers) {
        throw new CustomError(ERROR_MESSAGES.WORKSPACE.SOLE_OWNER_HAS_MEMBERS, 409)
    }
}

const deleteUserReceipts = async (userId: string): Promise<void> => {
    const receipts = await Receipt.find({ userId })

    for (const receipt of receipts) {
        if (isObjectStorageConfigured()) {
            await deleteReceiptObject(receiptObjectKey(userId, receipt.storedFilename))
        } else {
            deleteReceiptFile(userId, receipt.storedFilename)
        }
    }

    await Receipt.deleteMany({ userId }, BYPASS_SOFT_DELETE)
}

/**
 * Hard-erases every resource this user owns individually - a genuine GDPR-style deletion,
 * distinct from the sync layer's `deletedAt` tombstones used for multi-device propagation.
 * Shared master categories (`userId: null`) and workspace-owned resources belonging to other
 * members are untouched; `assertAccountDeletionAllowed` guards against orphaning a workspace.
 */
export const deleteUserAccountCascade = async (userId: string): Promise<void> => {
    await deleteUserReceipts(userId)

    await Promise.all([
        Transaction.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        Account.deleteMany({ userId }),
        Category.deleteMany({ userId }),
        Budget.deleteMany({ userId }),
        SavingsGoal.deleteMany({ userId }),
        SavingsGoalContribution.deleteMany({ userId }),
        RecurringRule.deleteMany({ userId }),
        Tag.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        CategorizationRule.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        TransactionTemplate.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        Notification.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        Saver.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        Pushover.deleteMany({ userId }),
        ReconciliationSession.deleteMany({ userId }),
        SavedReport.deleteMany({ userId }, BYPASS_SOFT_DELETE),
        Income.deleteMany({ userId }),
        Expense.deleteMany({ userId }),
    ])

    // Drop the now-deleted user from any workspace they were a (non-sole-owner) member of,
    // so other members' member lists don't keep a dangling userId reference.
    await Workspace.updateMany({ 'members.userId': userId }, { $pull: { members: { userId } } })

    await revokeAllRefreshTokensForUser(userId)
    await User.deleteOne({ _id: userId })
}
