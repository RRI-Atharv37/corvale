import React, { useContext, useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../../components/Inputs/Input'
import { validateEmail } from '../../utils/helper'
import axiosInstance from '../../utils/axiosInstance'
import { UserContext } from '../../context/userContext'

const Signup = () => {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  const navigate = useNavigate()

  const userContext = useContext(UserContext);

  if (!userContext) {
    throw new Error('UserContext is not provided');
  }

  const { updateUser } = userContext;

  const handleSignup = async(e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if(!fullName){
      setError('Please enter your full name.')
      return
    }

    if(!validateEmail(email)){
      setError('Please enter a valid email address.')
      return
    }

    if(!password){
      setError('Please enter a password')
      return
    }

    setError("")

    try{
      const response = await axiosInstance.post('/auth/register', {fullName, email, password}, {withCredentials: true, headers: {'Content-Type': 'application/json'}})

      const { token, user } = response.data

      if(token){
        localStorage.setItem('token', token)
        updateUser(user)
        navigate('/dashboard')
      }
    } catch(error: any) {
      console.error('Login Error:', error)

      if (error.response && error.response.data.message){
        setError(error.response.data.message)
      } else{
        setError('An error occurred. Please try again.')
      }
    }
  }
  
  return(
    <AuthLayout>
      <div className='lg:w-[100%] h-auto md:h-full mt-10 md:mt-0 flex flex-col justify-center'>
        <h3 className='text-xl font-semibold text-black'>Create an Account</h3>
        <p className='text-xs text-slate-700 mt-[5px] mb-6'>Join Us Today by Entering Your Details Below.</p>

        <form onSubmit={handleSignup}>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <Input
              value = {fullName}
              // onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
              onChange={(e) => setFullName(e.target.value)}
              label='Full Name'
              placeholder='Atharv Dewangan'
              type='text'
            />

            <Input 
              value={email}
              // onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              onChange={(e) => setEmail(e.target.value)}
              label = 'Email address'
              placeholder = 'abc@example.com'
              type = 'text'
            />

            <div className='col-span-2'>
              <Input
                value={password}
                // onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                onChange={(e) => setPassword(e.target.value)}
                label = 'Password'
                placeholder = 'Minimum 8 Characters'
                type = 'password'
              />
            </div>
          </div>  

          {error && <p className='text-red-500 text-xs pb-2.5'>{error}</p>}

          <button type='submit' className='btn-primary'>SIGNUP</button>

          <p className='text-[13px] text-slate-800 mt-3 '>Already have an account?{" "}
            <Link className='font-medium text-purple-500 underline' to='/login'>Login</Link>
          </p>
        </form> 
      </div>
    </AuthLayout>
  )
}

export default Signup