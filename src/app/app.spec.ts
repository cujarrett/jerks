import { TestBed } from '@angular/core/testing'
import { App } from './app'
import { AttackStats, Stats } from './stats'

const attacks: AttackStats = {
  probes: 12,
  sources: 5,
  // Noon on three days in a row, built from local clock parts so the test holds in any time zone.
  timestamps: [1, 2, 3].map((day) => new Date(2026, 6, day, 12).getTime() / 1000),
  // One request in the first bucket has no location.
  series: [3, 0, 9],
  places: [
    { city: 'Dallas', region: 'TX', lat: 32.8, lon: -96.8, hits: [[0, 2]] },
    { city: 'Boston', region: 'MA', lat: 42.4, lon: -71.1, hits: [[2, 9]] },
    { city: 'Honolulu', region: 'HI', lat: 21.3, lon: -157.9, hits: [[2, 0]] },
  ],
}

const fakeStats = { attacks: () => Promise.resolve({ data: attacks, at: Date.now() }) }

async function mount() {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [{ provide: Stats, useValue: fakeStats }],
  }).compileComponents()
  const fixture = TestBed.createComponent(App)
  fixture.detectChanges()
  await fixture.whenStable()
  await new Promise((resolve) => setTimeout(resolve))
  fixture.detectChanges()
  return fixture
}

describe('App', () => {
  function motion(reduced: boolean) {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduced } as MediaQueryList)
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the whole range at once when motion is reduced', async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    expect(el.querySelector('.figures .main dd')?.textContent).toBe('12')
    const caption = el.querySelector('.figures .main dt')
    expect(caption?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'attacks on my homelab in the last 30 days',
    )
    expect(caption?.querySelector('a')?.getAttribute('href')).toBe(
      'https://blog.mattjarrett.dev/homelab/',
    )
    // Honolulu is off the lower-48 map.
    const titles = [...el.querySelectorAll('.dots circle title')].map((t) => t.textContent)
    expect(titles).toEqual(['Boston, MA: 9 requests', 'Dallas, TX: 2 requests'])
    expect(el.querySelectorAll('circle.ring').length).toBe(0)
  })

  it('plays the dots in, then keeps sweeping with the map full', async () => {
    motion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    const after = (frames: number) => {
      vi.advanceTimersByTime(frames * 140)
      fixture.detectChanges()
      return {
        count: el.querySelector('.figures .main dd')?.textContent,
        dots: el.querySelectorAll('.dots circle').length,
        // Narrow no-break spaces in times become plain ones, which is how the test writes them.
        day: el.querySelector('.day')?.textContent?.replace(/\s/g, ' '),
      }
    }
    expect(after(0)).toEqual({ count: '0', dots: 0, day: '' })
    expect(after(1)).toEqual({ count: '3', dots: 1, day: 'July 1 at 12 PM' })
    expect(after(2)).toEqual({ count: '12', dots: 2, day: 'July 3 at 12 PM' })
    // The second sweep starts over at the first bucket, and Dallas pings again.
    const rings = el.querySelectorAll('circle.ring').length
    expect(after(1)).toEqual({ count: '12', dots: 2, day: 'July 1 at 12 PM' })
    expect(el.querySelectorAll('circle.ring').length).toBe(rings + 1)
    expect(el.querySelectorAll('circle.flash').length).toBe(rings + 1)
  })

  it('names the busiest cities', async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    const rows = [...el.querySelectorAll('.card li')].map((li) => li.textContent?.trim())
    expect(rows).toEqual(['Boston, MA9', 'Dallas, TX2'])
    expect(el.textContent).toContain('Nothing personal, Boston.')
  })

  it('has no controls, and links back to the homelab it watches', async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    expect(el.querySelectorAll('button').length).toBe(0)
    expect(el.querySelector('footer a')?.getAttribute('href')).toBe(
      'https://mattjarrett.dev/#homelab',
    )
  })
})
