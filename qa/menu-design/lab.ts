import '@/styles/tokens.css'
import '@/styles/menu-system.css'
import './lab.css'
import { createMenuLayout, createMenuDock } from '@/ui/menu/menuLayout'
import { createMenuAction, createMenuChoices } from '@/ui/menu/menuControls'
import { element } from '@/ui/dom'
import harbor from '@/assets/title/city-harbor.webp'
import red from '@/assets/vehicles/red.webp'
import blue from '@/assets/vehicles/blue.webp'
import green from '@/assets/vehicles/green.webp'
import yellow from '@/assets/vehicles/yellow.webp'

const mount = document.getElementById('lab')
if (!mount) throw new Error('Missing design lab root')
const layout = createMenuLayout('static')
const background = element('img')
background.src = harbor
background.alt = ''
layout.media.append(background)
layout.header.append(element('p', 'lab-eyebrow', 'TRACK FORGE / DESIGN LAB'))
const hero = element('div', 'lab-hero')
const copy = element('div', 'lab-copy')
copy.append(element('p', 'lab-eyebrow', 'THE GARAGE'), element('h1', 'lab-title', 'Built to race.'), element('p', 'lab-description', 'Material and interaction reference. Select a vehicle to explore the shared controls.'))
const car = element('img', 'lab-car')
car.src = red
car.alt = 'Red race car'
hero.append(copy, car)
layout.content.append(hero)
const images = { red, blue, green, yellow } as const
const selector = createMenuChoices<keyof typeof images>('Vehicle', [
  { value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' }, { value: 'yellow', label: 'Yellow' },
], 'red', value => {
  car.src = images[value]
  car.alt = `${value} race car`
})
const dock = createMenuDock('Vehicle selector', 'clear')
dock.append(selector.element)
const status = element('p', 'lab-status', 'Static media · clear material')
status.setAttribute('role', 'status')
const actions = createMenuDock('Example actions')
actions.append(
  createMenuAction('Material', 'lab-material', () => {
    const clear = dock.dataset.material === 'clear'
    dock.dataset.material = clear ? 'regular' : 'clear'
    status.textContent = clear ? 'Static media · regular material' : 'Static media · clear material'
  }),
  createMenuAction('Race', 'lab-race', () => { status.textContent = 'Primary action received · lab only' }, 'primary'),
)
layout.actions.append(dock, actions, status)
mount.append(layout.root)
