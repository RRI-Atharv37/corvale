import React, { createContext, useState } from 'react'

interface User {
  _id: string
  fullName: string
  email: string
  token?: string
}

interface UserContextType {
  user: User | null
  updateUser: (user: User) => void
  clearUser: () => void
}

export const UserContext = createContext<UserContextType | null>(null)

const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null)
    // const [loading, setLoading] = useState(true)
    const updateUser = (userData: User) => {
        setUser(userData)
    }

    const clearUser = () => {
        setUser(null)
    }

    return(
        <UserContext.Provider value={{ user, updateUser, clearUser }}>
            {children}
        </UserContext.Provider>
    )
}

export default UserProvider