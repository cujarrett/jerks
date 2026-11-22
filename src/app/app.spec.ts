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
  kinds: [
    { kind: 'env', count: 6 },
    { kind: 'git', count: 3 },
    { kind: 'made-up', count: 1 },
  ],
}

// What the fake API answers with. A test can swap it, and it goes back after each one.
let served = attacks
const fakeStats = { attacks: () => Promise.resolve({ data: served, at: Date.now() }) }

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
    served = attacks
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
    const names = [...el.querySelectorAll('.dots circle')].map((c) => c.getAttribute('aria-label'))
    expect(names).toEqual([
      'Boston, MA: 9 attacks · 75% of all · last on Jul 3',
      'Dallas, TX: 2 attacks · 17% of all · last on Jul 1',
    ])
    expect(el.querySelectorAll('circle.ring').length).toBe(0)
    expect(el.querySelector('.map .home')?.getAttribute('aria-label')).toBe("Matt's Homelab")
    expect(el.querySelector('.map .home')?.getAttribute('href')).toBe(
      'https://blog.mattjarrett.dev/homelab/',
    )
  })

  it('plays the dots in once, then moves the map only when the number moves', async () => {
    motion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Every frame may add a held-back attack, so the count is the same on every run.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    const after = (frames: number) => {
      vi.advanceTimersByTime(frames * 70)
      fixture.detectChanges()
      return {
        count: el.querySelector('.figures .main dd')?.textContent,
        dots: el.querySelectorAll('.dots circle').length,
        day: el.querySelector('.day')?.textContent,
        rings: el.querySelectorAll('circle.ring').length,
      }
    }
    expect(after(0)).toEqual({ count: '0', dots: 0, day: '', rings: 0 })
    expect(after(1)).toEqual({ count: '3', dots: 1, day: 'July 1', rings: 1 })
    // One of the 12 is held back until the sweep is over.
    expect(after(2)).toEqual({ count: '11', dots: 2, day: 'Jul 1 to Jul 3', rings: 2 })
    // It arrives, and its city flashes. The sweep does not start over.
    expect(after(1)).toEqual({ count: '12', dots: 2, day: 'Jul 1 to Jul 3', rings: 3 })
    // Nothing is owed now, so the map goes still once the last rings fade.
    expect(after(20)).toEqual({ count: '12', dots: 2, day: 'Jul 1 to Jul 3', rings: 0 })
  })

  it('holds back the last attacks and adds them one at a time after the sweep', async () => {
    motion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Every frame may add one. A real page waits a random number of frames between them.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    served = { ...attacks, probes: 30, series: [10, 10, 10] }
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    const count = (frames: number) => {
      vi.advanceTimersByTime(frames * 70)
      fixture.detectChanges()
      return el.querySelector('.figures .main dd')?.textContent
    }
    // A tenth of 30 is held back, so the sweep ends 3 short.
    expect(count(3)).toBe('27')
    expect(count(1)).toBe('28')
    expect(count(2)).toBe('30')
    expect(count(5)).toBe('30')
  })

  it('says what they wanted in plain words, and names the busiest cities', async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    const rows = (card: number) =>
      [...el.querySelectorAll(`.cards article:nth-of-type(${card}) li`)].map((li) =>
        li.textContent?.trim(),
      )
    // A kind this page has no words for is left out.
    expect(rows(1)).toEqual(['passwords in .env files60%', 'source code in .git30%'])
    expect(rows(2)).toEqual(['Boston, MA9', 'Dallas, TX2'])
  })

  it('draws a data centre as a ring, and leaves it out of the cities and the jerks', async () => {
    motion(true)
    served = {
      ...attacks,
      places: [
        ...attacks.places,
        { city: 'Ashburn', region: 'VA', lat: 39, lon: -77.5, edge: true, hits: [[1, 50]] },
      ],
    }
    const el = (await mount()).nativeElement as HTMLElement
    const edge = el.querySelector('.dots circle.edge')
    expect(edge?.getAttribute('aria-label')).toMatch(/^Cloudflare in Ashburn, VA: 50 stopped here/)
    expect(el.querySelectorAll('.dots circle:not(.edge)').length).toBe(2)
    expect(el.querySelector('.map')?.getAttribute('aria-label')).toMatch(/^Map of the 3 US cities/)
    const jerks = [...el.querySelectorAll('.cards article:nth-of-type(2) li span')]
    expect(jerks.map((s) => s.textContent)).toEqual(['Boston, MA', 'Dallas, TX'])
  })

  it('shows one number in the hero, with an arrow to the cards below', async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    expect(el.querySelectorAll('.figures dd').length).toBe(1)
    expect(el.querySelector('.cue')?.getAttribute('href')).toBe('#more')
    expect(el.querySelector('#more')).not.toBeNull()
  })

  it('keeps the wall rows adding up to the reached count while attacks are held back', async () => {
    motion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    served = {
      ...attacks,
      walls: [
        { wall: 'waf', count: 4 },
        { wall: 'web', count: 7 },
        { wall: 'gateway', count: 1 },
      ],
    }
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    const row = (name: string) =>
      Number(
        [...el.querySelectorAll('app-defenses li')]
          .find((li) => li.querySelector('span')?.textContent === name)
          ?.querySelector('b i')?.textContent ?? 0,
      )
    const sums = () => {
      fixture.detectChanges()
      return {
        reached: Number(el.querySelector('.reach b')?.textContent),
        rows: row('Gateway') + row('Web server'),
      }
    }
    const boston = () =>
      [...el.querySelectorAll('article')]
        .find((a) => a.querySelector('h2')?.textContent === 'Biggest jerks.')
        ?.querySelector('li b')?.textContent
    // The rows climb with the sweep and add up to "reached" on every frame of it.
    for (let frame = 0; frame < 3; frame++) {
      const now = sums()
      expect(now.rows).toBe(now.reached)
      vi.advanceTimersByTime(70)
    }
    // The sweep ends. The newest attack is Boston's, so Boston still waits for it.
    expect(sums()).toEqual({ reached: 7, rows: 7 })
    expect(boston()).toBe('8')
    // It arrives, and every number that counts it ticks together.
    vi.advanceTimersByTime(70)
    expect(sums()).toEqual({ reached: 8, rows: 8 })
    expect(boston()).toBe('9')
  })

  it('adds the jerks card up to the reached count, with a row for everywhere else', async () => {
    motion(false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    // Four more requests, all stopped at a Cloudflare data centre.
    served = {
      ...attacks,
      probes: 16,
      series: [3, 0, 13],
      places: [
        ...attacks.places,
        { city: 'Ashburn', region: 'VA', lat: 39, lon: -77.5, edge: true, hits: [[2, 4]] },
      ],
      walls: [
        { wall: 'waf', count: 4 },
        { wall: 'web', count: 11 },
        { wall: 'gateway', count: 1 },
      ],
    }
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    const read = () => {
      fixture.detectChanges()
      const rows = [
        ...([...el.querySelectorAll('article')]
          .find((a) => a.querySelector('h2')?.textContent === 'Biggest jerks.')
          ?.querySelectorAll('li') ?? []),
      ].map((li) => [
        li.querySelector('span')?.textContent,
        Number(li.querySelector('b')?.textContent),
      ])
      return {
        last: rows.at(-1)?.[0],
        card: rows.reduce((sum, row) => sum + (row[1] as number), 0),
        reached: Number(el.querySelector('.reach b')?.textContent),
        big: Number(el.querySelector('.figures .main dd')?.textContent),
        edge: Number(el.querySelector('.edge-note')?.textContent?.replace(/\D/g, '')),
      }
    }
    // Through the sweep and the one held-back attack after it, every frame adds up.
    for (let frame = 0; frame < 5; frame++) {
      const now = read()
      expect(now.card).toBe(now.reached)
      expect(now.big).toBe(now.edge + now.reached)
      vi.advanceTimersByTime(70)
    }
    // One request has no city, so it is the row for everywhere else.
    expect(read().last).toBe('Everywhere else')
    expect(read()).toMatchObject({ big: 16, edge: 4, reached: 12, card: 12 })
  })

  it('keys the rings under the map, and says the cards cover only what reached my homelab', async () => {
    motion(true)
    // With no count from Cloudflare the map has no rings, so there is nothing to explain.
    expect((await mount()).nativeElement.querySelector('.reach')).toBeNull()

    TestBed.resetTestingModule()
    served = { ...attacks, walls: [{ wall: 'waf', count: 4 }] }
    const el = (await mount()).nativeElement as HTMLElement
    const text = (selector: string) =>
      el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()
    expect(text('.under .edge-note')).toBe('4 stopped by Cloudflare')
    expect(text('.reach')).toBe('Of the 8 that reached my homelab.')
  })

  it('still works with an API that sends no kinds yet', async () => {
    motion(true)
    served = { ...attacks, kinds: undefined }
    const el = (await mount()).nativeElement as HTMLElement
    expect(el.querySelectorAll('.cards article').length).toBe(1)
  })

  it('labels a dot the moment the pointer is on it', async () => {
    motion(true)
    const fixture = await mount()
    const el = fixture.nativeElement as HTMLElement
    expect(el.querySelector('.tip')).toBeNull()

    const boston = el.querySelector('.dots circle') as SVGCircleElement
    boston.dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(el.querySelector('.tip b')?.textContent).toBe('Boston, MA')
    expect(el.querySelector('.tip span')?.textContent).toBe(
      '9 attacks · 75% of all · last on Jul 3',
    )

    boston.dispatchEvent(new Event('pointerleave'))
    fixture.detectChanges()
    expect(el.querySelector('.tip')).toBeNull()

    el.querySelector('.map .home')?.dispatchEvent(new Event('pointerenter'))
    fixture.detectChanges()
    expect(el.querySelector('.tip b')?.textContent).toBe("Matt's Homelab")
    expect(el.querySelector('.tip span')).toBeNull()
  })

  it("has no controls, and links the maker's name to his site", async () => {
    motion(true)
    const el = (await mount()).nativeElement as HTMLElement
    expect(el.querySelectorAll('button').length).toBe(0)
    expect(el.querySelector('footer')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Made by Matt Jarrett with ♥ and Kubernetes',
    )
    // Only the name is the link.
    expect(el.querySelector('footer a')?.textContent).toBe('Matt Jarrett')
    expect(el.querySelector('footer a')?.getAttribute('href')).toBe('https://mattjarrett.dev')
  })
})
