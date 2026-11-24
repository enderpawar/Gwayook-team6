import 'wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.css'
import '@fontsource/bagel-fat-one/400.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initStore } from './data/useStore'

await initStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
