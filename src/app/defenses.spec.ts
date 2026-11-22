import { TestBed } from '@angular/core/testing'
import { Defenses, Hit } from './defenses'
import { MAP_HEIGHT, MAP_WIDTH } from './us-map'

// Stands in for the browser's observer. Calling scrollIntoView brings the rings on screen.
let scrollIntoView: () => void
class FakeObserver {
  constructor(seen: (entries: { isIntersecting: boolean }[]) => void) {
    scrollIntoView = () => seen([{ isIntersecting: true }])
  }
  observe = vi.fn()
  disconnect = vi.fn()
}

// The rings are in view before the flashes arrive, and one tick sends them all.
async function mount(hits: Hit[], stops?: { wall: string; count: number }[]) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  await TestBed.configureTestingModule({ imports: [Defenses] }).compileComponents()
  const fixture = TestBed.createComponent(Defenses)
  fixture.componentRef.setInput('hits', [])
  if (stops) fixture.componentRef.setInput('stops', stops)
  fixture.detectChanges()
  scrollIntoView()
  fixture.componentRef.setInput('hits', hits)
  fixture.detectChanges()
  vi.advanceTimersByTime(133)
  fixture.detectChanges()
  return fixture.nativeElement as HTMLElement
}

describe('Defenses', () => {
  beforeEach(() => {
    scrollIntoView = () => {
      throw new Error('the component has not started watching for the rings yet')
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('replays the flashes it missed when the rings come into view, then keeps looping them', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const fixture = TestBed.createComponent(Defenses)
    const el = fixture.nativeElement as HTMLElement
    const at = { x: 0, y: 0 }
    const shots = (hits?: Hit[]) => {
      if (hits) fixture.componentRef.setInput('hits', hits)
      fixture.detectChanges()
      return el.querySelectorAll('circle.shot').length
    }
    // Two frames of the map play while the rings are off screen, then their flashes fade.
    expect(
      shots([
        { id: 0, ...at },
        { id: 1, ...at },
      ]),
    ).toBe(0)
    expect(shots([{ id: 2, ...at }])).toBe(0)
    expect(shots([])).toBe(0)

    scrollIntoView()
    vi.advanceTimersByTime(133)
    expect(shots()).toBe(2)
    vi.advanceTimersByTime(133)
    expect(shots()).toBe(3)
    // A flash that arrives now joins the queue and flies on the next tick.
    expect(shots([{ id: 3, ...at }])).toBe(3)
    vi.advanceTimersByTime(133)
    expect(shots()).toBe(4)
    // The queue runs dry, and the rings play the same attacks again rather than going still.
    vi.advanceTimersByTime(133 * 40)
    expect(shots()).toBeGreaterThan(0)
  })

  it('draws the six walls from the outside in, and marks the one that stops the attacks', async () => {
    const el = await mount([])
    const rows = [...el.querySelectorAll('ol li')].map((li) =>
      ['span', 'small', 'b'].map((part) => li.querySelector(part)?.textContent?.trim()),
    )
    expect(rows).toEqual([
      ['WAF', 'Cloudflare Bot Fight Mode and WAF rules', ''],
      ['Firewall', 'UniFi router and ISP NAT', ''],
      ['Gateway', 'Traefik rate limit', ''],
      ['Web server', 'nginx deny by default', ''],
      ['Service mesh', 'Istio mTLS and allow lists', ''],
      ['Container', 'Kubernetes non-root, read-only', ''],
    ])
    expect(el.querySelectorAll('circle.wall').length).toBe(6)
    expect(el.querySelector('li.stop span')?.textContent).toBe('Web server')
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
      el.querySelector('li.on span')?.textContent,
    ]
    expect(lit()).toEqual([undefined, undefined])

    el.querySelector('ol li')?.dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(lit()).toEqual(['290', 'WAF'])

    el.querySelector('ol li')?.dispatchEvent(new Event('pointerleave'))
    el.querySelectorAll('circle.wall')[5].dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(lit()).toEqual(['50', 'Container'])
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

  it('stops the dots at each wall in the shares the API counted', async () => {
    const hits = Array.from({ length: 200 }, (_, id) => ({ id, x: 0, y: 0 }))
    const stoppedAt = (el: HTMLElement) => {
      const at = [...el.querySelectorAll('circle.spark')].map((c) => c.getAttribute('cx'))
      return {
        gateway: at.filter((r) => r === '194').length,
        web: at.filter((r) => r === '146').length,
      }
    }
    // An API with no counts yet sends every dot to the web server.
    expect(stoppedAt(await mount(hits))).toEqual({ gateway: 0, web: 200 })

    TestBed.resetTestingModule()
    const el = await mount(hits, [
      { wall: 'web', count: 90 },
      { wall: 'gateway', count: 10 },
      { wall: 'made-up', count: 500 },
    ])
    const split = stoppedAt(el)
    // A tenth of 200, give or take the spread. A wall this page does not know is left out.
    expect(split.gateway + split.web).toBe(200)
    expect(split.gateway).toBeGreaterThan(14)
    expect(split.gateway).toBeLessThan(26)
    // Both walls that stopped attacks are red, and each row says how many.
    const red = [...el.querySelectorAll('circle.wall.stop')].map((c) => c.getAttribute('r'))
    expect(red).toEqual(['194', '146'])
    const counts = [...el.querySelectorAll('li.stop i')].map((i) => i.textContent)
    expect(counts).toEqual(['10', '90'])
    // The counted walls answered every attack, so the mesh behind them stopped none.
    // The container is not behind them, because the web server runs inside it.
    const quiet = [...el.querySelectorAll('ol li:not(.stop) b')].map((b) => b.textContent?.trim())
    expect(quiet).toEqual(['', '', '0 stopped here', ''])
  })
})
