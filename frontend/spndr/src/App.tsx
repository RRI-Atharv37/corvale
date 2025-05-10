import React from 'react'
import{BrowserRouter as Router, Routes, Route, Navigate} from 'react-router-dom'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import Home from './pages/Dashboard/Home'
import Income from './pages/Dashboard/Income'
import Expense from './pages/Dashboard/Expense'
import Saver from './pages/Dashboard/Saver'
import Pushover from './pages/Dashboard/Pushover'
import UserProvider from './context/userContext'

const App = () => {
  return(
    <UserProvider>
    <div>
      <Router>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/dashboard" element={<Home />} />
          <Route path="/income" element={<Income />} />
          <Route path="/expense" element={<Expense />} />
          <Route path="/saver" element={<Saver />} />
          <Route path="/pushover" element={<Pushover />} />
        </Routes>
      </Router>
    </div>
    </UserProvider>
  )
}

export default App

const Root = () => {
  const isAuth = !!localStorage.getItem('token')

  return isAuth ? (
    <Navigate to='/dashboard' />
  ) : (
    <Navigate to='/login' />
  )
}