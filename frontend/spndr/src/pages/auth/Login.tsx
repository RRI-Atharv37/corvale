import React, { useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../../components/Inputs/Input'
import { validateEmail } from '../../utils/helper'

const Login = () => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleLogin = async(e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!validateEmail(email)) {
      setError('Please enter a valid email address')
      return
    }

    if(!password){
      setError('Please enter a password.')
      return
    }

    setError("")
  }

  return(
    <AuthLayout>
      <div className='lg:w-[70%] h-3/4 md:h-full flex flex-col justify-center'>
        <h3 className='text-xl font-semibold text-black'>Welcome Back</h3>
        <p className='text-xs text-slate-700 mt-[5px] mb-6'>Please enter your login details</p>

        <form onSubmit={handleLogin}>
          <Input 
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            label = 'Email address'
            placeholder = 'abc@example.com'
            type = 'text'
          />

          <Input
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            label = 'Password'
            placeholder = 'Minimum 8 Characters'
            type = 'password'
          />

          {error && <p className='text-red-500 text-x pb-2.5'>{error}</p>}

          <button type='submit' className='btn-primary'>LOGIN</button>

          <p className='text-[13px] text-slate-800 mt-3 '>Don't have an account?{" "}
            <Link className='font-medium text-purple-500 underline' to='/signup'>Signup</Link>
          </p>
        </form>
      </div>
    </AuthLayout>
  )
}

export default Login