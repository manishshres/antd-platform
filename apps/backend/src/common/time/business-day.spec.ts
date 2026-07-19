import {
  startOfBusinessDay,
  endOfBusinessDay,
  DEFAULT_TIMEZONE,
} from './business-day';

describe('business-day helpers', () => {
  const NY = 'America/New_York';

  describe('startOfBusinessDay', () => {
    it('maps a NY calendar day to 04:00Z in summer (EDT, UTC-4)', () => {
      // 2026-07-19 is during EDT.
      expect(startOfBusinessDay('2026-07-19', NY).toISOString()).toBe(
        '2026-07-19T04:00:00.000Z',
      );
    });

    it('maps a NY calendar day to 05:00Z in winter (EST, UTC-5)', () => {
      expect(startOfBusinessDay('2026-01-15', NY).toISOString()).toBe(
        '2026-01-15T05:00:00.000Z',
      );
    });

    it('resolves a Date to its NY calendar day, not the server day', () => {
      // 2026-07-20T02:30:00Z is still 2026-07-19 22:30 in NY, so the business
      // day started at 2026-07-19T04:00Z — even though a UTC server would call
      // it the 20th.
      const instant = new Date('2026-07-20T02:30:00.000Z');
      expect(startOfBusinessDay(instant, NY).toISOString()).toBe(
        '2026-07-19T04:00:00.000Z',
      );
    });
  });

  describe('endOfBusinessDay', () => {
    it('a NY-local order at 23:59 falls inside the same business day on a UTC clock', () => {
      // 2026-07-19 23:59 local == 2026-07-20T03:59Z. A naive server using UTC
      // midnight would push it into the 20th; the tz-aware bounds keep it in the
      // 19th.
      const localLateNight = new Date('2026-07-20T03:59:00.000Z');
      const start = startOfBusinessDay('2026-07-19', NY);
      const end = endOfBusinessDay('2026-07-19', NY);
      expect(localLateNight >= start).toBe(true);
      expect(localLateNight <= end).toBe(true);
      expect(end.toISOString()).toBe('2026-07-20T03:59:59.999Z');
    });
  });

  it('falls back to the default timezone when none is given', () => {
    expect(startOfBusinessDay('2026-07-19').toISOString()).toBe(
      startOfBusinessDay('2026-07-19', DEFAULT_TIMEZONE).toISOString(),
    );
  });
});
