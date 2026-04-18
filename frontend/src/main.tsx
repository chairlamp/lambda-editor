import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import { applyTheme } from './design'
import { useStore } from './store/useStore'

applyTheme(useStore.getState().theme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
