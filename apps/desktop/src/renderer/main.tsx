import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Overlay } from './views/Overlay'
import { BrowseChrome } from './views/BrowseChrome'
import { MainApp } from './views/MainApp'
import { Typing } from './views/Typing'
import { selfTest } from './lib/engine'
;(window as unknown as { __glanceSelfTest: typeof selfTest }).__glanceSelfTest = selfTest

const route = (location.hash.replace(/^#\/?/, '') || 'main').split('?')[0]
document.documentElement.classList.add('dark')
if (route === 'overlay') document.documentElement.classList.add('overlay')

const View = route === 'overlay' ? Overlay : route === 'browse' ? BrowseChrome : route === 'typing' ? Typing : MainApp
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <View />
  </React.StrictMode>,
)
