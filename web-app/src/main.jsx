import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Authenticator } from '@aws-amplify/ui-react'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Authenticator
      formFields={{
        signIn: {
          username: {
            label: 'メールアドレスまたは電話番号',
            placeholder: 'you@example.com / 09012345678'
          }
        },
        signUp: {
          username: {
            label: 'メールアドレスまたは電話番号',
            placeholder: 'you@example.com / 09012345678'
          }
        }
      }}
    >
      <App />
    </Authenticator>
  </StrictMode>,
)
