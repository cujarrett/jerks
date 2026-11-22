import { TestBed } from '@angular/core/testing'
import { Defenses, Hit } from './defenses'
import { MAP_HEIGHT, MAP_WIDTH } from './us-map'

async function mount(hits: Hit[]) {
  await TestBed.configureTestingModule({ imports: [Defenses] }).compileComponents()
  const fixture = TestBed.createComponent(Defenses)
  fixture.componentRef.setInput('hits', hits)
  fixture.detectChanges()
  return fixture.nativeElement as HTMLElement
}

describe('Defenses', () => {
  it('draws the six walls from the outside in, and marks the one that stops the attacks', async () => {
    const el = await mount([])
    const names = [...el.querySelectorAll('ol li b')].map((b) => b.textContent)
    expect(names).toEqual(['Cloudflare', 'Tunnel', 'Traefik', 'Web server', 'Istio', 'Pod'])
    expect(el.querySelectorAll('circle.wall').length).toBe(6)
    expect(el.querySelector('li.stop b')?.textContent).toBe('Web server')
    expect(el.querySelector('circle.wall.stop')?.getAttribute('r')).toBe('146')
    expect(el.querySelectorAll('circle.shot').length).toBe(0)
  })

  it('lights a wall and its row together when the pointer is on either', async () => {
    const fixture = TestBed.createComponent(Defenses)
    fixture.componentRef.setInput('hits', [])
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    const lit = () => [
      el.querySelector('circle.on')?.getAttribute('r'),
      el.querySelector('li.on b')?.textContent,
    ]
    expect(lit()).toEqual([undefined, undefined])

    el.querySelector('ol li')?.dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(lit()).toEqual(['290', 'Cloudflare'])

    el.querySelector('ol li')?.dispatchEvent(new Event('pointerleave'))
    el.querySelectorAll('circle.wall')[5].dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(lit()).toEqual(['50', 'Pod'])
  })

  it('sends one dot per flash, from the side of the map its city is on', async () => {
    const middle = { y: MAP_HEIGHT / 2 }
    // Ids 3 and 10 are both the middle lane, so the angle is the bearing alone.
    const el = await mount([
      { id: 3, x: MAP_WIDTH, ...middle },
      { id: 10, x: 0, ...middle },
    ])
    const turns = [...el.querySelectorAll('circle.shot')].map((c) =>
      c.parentElement?.getAttribute('transform'),
    )
    expect(turns).toEqual(['rotate(0)', 'rotate(180)'])
  })
})
