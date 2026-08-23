import { normalizePhoneVariables, toE164 } from './phone.util';

describe('toE164', () => {
  it.each([
    ['2513158850', '+12513158850'],
    ['(610) 352-2102', '+16103522102'],
    ['1-610-352-2102', '+16103522102'],
    ['+1 610 352 2102', '+16103522102'],
    ['+16103522102', '+16103522102'],
  ])('normalises %s to %s', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it('leaves template placeholders alone', () => {
    // Telnyx resolves these at call time; rewriting one would break the transfer.
    expect(toE164('{{telnyx_end_user_target}}')).toBeNull();
  });

  it('refuses to guess when the digits are ambiguous', () => {
    // Better to pass the operator's value through and fail loudly than to invent a
    // country code and dial a stranger.
    expect(toE164('12345')).toBeNull();
    expect(toE164('not a phone')).toBeNull();
  });
});

describe('normalizePhoneVariables', () => {
  it('fixes phone-shaped keys and leaves everything else untouched', () => {
    // The exact payload that produced Telnyx 10016: main_phone_number had no country code.
    const result = normalizePhoneVariables({
      main_phone_number: '2513158850',
      manager_number: '+16103522102',
      customerPhone: '{{telnyx_end_user_target}}',
      company_name: 'Ekta Indian Cuisine',
      local_tax: '6.5',
    });

    expect(result).toEqual({
      main_phone_number: '+12513158850',
      manager_number: '+16103522102',
      customerPhone: '{{telnyx_end_user_target}}',
      company_name: 'Ekta Indian Cuisine',
      local_tax: '6.5',
    });
  });

  it('does not touch non-phone keys that happen to hold digits', () => {
    expect(normalizePhoneVariables({ local_tax: '6103522102' })).toEqual({
      local_tax: '6103522102',
    });
  });
});
