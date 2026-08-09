import { EscPosBuilder, ESC, GS, LINE_WIDTH, MARGIN_DOTS, PRINT_AREA_DOTS } from './escpos-builder';

describe('EscPosBuilder', () => {
  let builder: EscPosBuilder;

  beforeEach(() => {
    builder = new EscPosBuilder();
  });

  it('generates initialization sequence ESC @', () => {
    const buf = builder.init().build();
    expect(buf).toEqual(Buffer.from([ESC, 0x40]));
  });

  it('configures print area margins with GS L and GS W', () => {
    const buf = builder.setPrintArea(MARGIN_DOTS, PRINT_AREA_DOTS).build();
    // MARGIN_DOTS = 24 -> [0x18, 0x00]
    // PRINT_AREA_DOTS = 528 -> [0x10, 0x02]
    expect(buf).toEqual(
      Buffer.from([GS, 0x4c, 0x18, 0x00, GS, 0x57, 0x10, 0x02]),
    );
  });

  it('sets text alignment (left, center, right)', () => {
    const buf = builder
      .align('left')
      .align('center')
      .align('right')
      .build();

    expect(buf).toEqual(
      Buffer.from([ESC, 0x61, 0, ESC, 0x61, 1, ESC, 0x61, 2]),
    );
  });

  it('toggles bold mode ESC E n', () => {
    const buf = builder.bold(true).bold(false).build();
    expect(buf).toEqual(Buffer.from([ESC, 0x45, 1, ESC, 0x45, 0]));
  });

  it('clamps and sets character size GS ! n', () => {
    // size(1, 1) -> 0x00
    // size(2, 2) -> (1<<4)|1 = 0x11
    // size(10, 10) -> clamped to 8x8 = (7<<4)|7 = 0x77
    const buf = builder.size(1, 1).size(2, 2).size(10, 10).build();
    expect(buf).toEqual(Buffer.from([GS, 0x21, 0x00, GS, 0x21, 0x11, GS, 0x21, 0x77]));
  });

  it('appends plain text and line breaks', () => {
    const buf = builder.text('Hello').line('World').build();
    const str = buf.toString('utf8');
    expect(str).toContain('Hello');
    expect(str).toContain('World\r\n');
  });

  it('formats full-width horizontal rule', () => {
    const buf = builder.rule('=').build();
    const str = buf.toString('utf8');
    expect(str).toBe('='.repeat(LINE_WIDTH) + '\r\n');
  });

  it('formats 2-column receipt row with right alignment and truncation', () => {
    const buf = builder
      .row('Cheeseburger Deluxe with Extra Bacon and Cheese', '$14.99')
      .build();

    const str = buf.toString('utf8');
    expect(str.length).toBe(LINE_WIDTH + 2); // 44 chars + \r\n
    expect(str).toContain('$14.99');
  });

  it('emits cash drawer kick and paper cut commands', () => {
    const buf = builder.openCashDrawer().cut().build();
    expect(buf).toEqual(
      Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa, GS, 0x56, 0x42, 0x00]),
    );
  });
});
