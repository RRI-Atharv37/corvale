import mongoose, {Document, Model, Schema, Types } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser extends Document {
    _id: Types.ObjectId
    fullName: string
    email: string
    password: string
    comparePassword(candidatePassword: string): Promise<boolean>
}

const userSchema = new Schema<IUser>(
    {
    fullName: {type: String, required: true},
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    }, {timestamps: true}
)

userSchema.pre<IUser>('save', async function (next) {
    if(!this.isModified('password')) return next()
    this.password = await bcrypt.hash(this.password, 10)
    next()
})

userSchema.methods.comparePassword = async function (candidatePassword: string) {
    return await bcrypt.compare(candidatePassword, this.password)
}

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema)
export default User