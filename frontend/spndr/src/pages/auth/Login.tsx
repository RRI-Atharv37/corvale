import React, { useContext, useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../../components/inputs/Input'
import { validateEmail } from '../../utils/helper'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { UserContext } from '../../context/UserContext'

const Login = () => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const userContext = useContext(UserContext);

  if (!userContext) {
    throw new Error('UserContext is not provided');
  }

  const { updateUser } = userContext;

  const handleLogin = async(e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // console.log('Login Request:', { email, password })

    if (!validateEmail(email)) {
      setError('Please enter a valid email address')
      return
    }

    if(!password){
      setError('Please enter a password.')
      return
    }

    setError("")

    try{
      // console.log("Login endpoint:", API_PATHS.AUTH.LOGIN)
      const response = await axiosInstance.post(API_PATHS.AUTH.LOGIN, {email, password}, {withCredentials: true, headers: {'Content-Type': 'application/json'}})
      // console.log('Login Response:', response)

      const authData = (response as any).data ?? response
      const { token, user } = authData?.data ?? authData

      if(!token){
        setError('Invalid response from server. Please try again.')
        return
      } 

      if(token){
        localStorage.setItem('token', token)
        updateUser(user)
        navigate('/dashboard')
      } else {
        setError('Login failed. Please try again.');
      }
    } catch(error: any) {
      // console.error('Login Error:', error)

      if (error.response && error.response.data.message){
        setError(error.response.data.message)
      } else{
        setError('An error occurred. Please try again.')
      }
    }
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