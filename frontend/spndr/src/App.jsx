import React from 'react'
import{BrowserRouter as Router, Routes, Route, Navigate} from 'react-router-dom'

import Login from './pages/auth/login'
import Signup from './pages/auth/Signup'
import Home from './pages/Dashboard/Home'
import Income from './pages/Dashboard/Income'
import Expense from './pages/Dashboard/Expense'
import Saver from './pages/Dashboard/Saver'
import Pushover from './pages/Dashboard/Pushover'

const App = () => {
  return(
    <div>
      <Router>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" exact element={<Login />} />
          <Route path="/signup" exact element={<Signup />} />
          <Route path="/dashboard" exact element={<Home />} />
          <Route path="/income" exact element={<Income />} />
          <Route path="/expense" exact element={<Expense />} />
          <Route path="/saver" exact element={<Saver />} />
          <Route path="/pushover" exact element={<Pushover />} />
        </Routes>
      </Router>
    </div>
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