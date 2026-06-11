import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { BrokenAppBoundary } from './BrokenAppBoundary.jsx'
import './index.css'
import { registerServiceWorker } from './services/serviceWorker.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrokenAppBoundary>
      <App />
    </BrokenAppBoundary>
  </React.StrictMode>,
)

registerServiceWorker()
