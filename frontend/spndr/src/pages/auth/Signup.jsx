import React, { useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../../components/Inputs/Input'
import { validateEmail } from '../../utils/helper'

const Signup = () => {
  const [FullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  const navigate = useNavigate()

  const handleSignup = async(e) => {
    e.preventDefault()

    if(!FullName){
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
  }
  
  return(
    <AuthLayout>
      <div className='lg:w-[100%] h-auto md:h-full mt-10 md:mt-0 flex flex-col justify-center'>
        <h3 className='text-xl font-semibold text-black'>Create an Account</h3>
        <p className='text-xs text-slate-700 mt-[5px] mb-6'>Join Us Today by Entering Your Details Below.</p>

        <form onSubmit={handleSignup}>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <Input
              value = {FullName}
              onChange={({target}) => setFullName(target.value)}
              label='Full Name'
              placeholder='Atharv Dewangan'
              type='text'
            />

            <Input 
              value={email}
              onChange={({target}) => setEmail(target.value)}
              label = 'Email address'
              placeholder = 'abc@example.com'
              type = 'text'
            />

            <div className='col-span-2'>
              <Input
                value={password}
                onChange={({target}) => setPassword(target.value)}
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