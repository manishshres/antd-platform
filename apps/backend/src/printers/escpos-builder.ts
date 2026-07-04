/**
 * ESC/POS command builder for 80mm thermal receipts.
 *
 * Command bytes are taken from the Cloud Printer User Manual V2 §9 ("Printer
 * ESC/POS Command example") and the standard ESC/POS instruction set:
 *
 *   1B 40          ESC @     initialize printer
 *   1B 61 n        ESC a n   justify: 0 left, 1 center, 2 right
 *   1B 45 n        ESC E n   bold: 0 off, 1 on
 *   1D 21 n        GS  ! n   character size (width<<4 | height), 0x11 = 2x2
 *   1B 64 n        ESC d n   feed n lines
 *   1D 56 42 n     GS  V     cut paper (n = feed before cut, dots)
 *   1C 26          FS  &     enable multibyte (used by the manual for CJK)
 *
 * Text is emitted as UTF-8. For pure-ASCII receipts this matches the printer's
 * default code page; if you print non-Latin scripts, download the matching TTF
 * font to the printer first (manual §4) — that is a device-side setup step.
 */

export const ESC = 0x1b;
export const GS = 0x1d;

export type Align = 'left' | 'center' | 'right';

/**
 * Receipt characters per line. The 80mm head prints 576 dots = 48 chars at
 * Font A (12 dots/char). We reserve a 2-char (24-dot) margin on each side for
 * breathing room, leaving 44 printable characters.
 */
export const LINE_WIDTH = 44;

/** Dots of left/right margin (24 dots ≈ 3mm at 8 dots/mm). */
export const MARGIN_DOTS = 24;
/** Printable area width in dots = 576 - 2 * margin. */
export const PRINT_AREA_DOTS = 576 - 2 * MARGIN_DOTS;

/**
 * Fluent builder that accumulates ESC/POS bytes. Keep instances short-lived —
 * one per receipt — and call build() once.
 */
export class EscPosBuilder {
  private chunks: Buffer[] = [];

  /** ESC @ — reset to a known state. Always start a receipt with this. */
  init(): this {
    return this.raw(ESC, 0x40);
  }

  /**
   * Set the left margin (GS L) and print-area width (GS W), both in dots, so
   * content is inset from the paper edges. Call once, right after init().
   */
  setPrintArea(leftDots: number, widthDots: number): this {
    return this.raw(GS, 0x4c, leftDots & 0xff, (leftDots >> 8) & 0xff).raw(
      GS,
      0x57,
      widthDots & 0xff,
      (widthDots >> 8) & 0xff,
    );
  }

  align(a: Align): this {
    const n = a === 'center' ? 1 : a === 'right' ? 2 : 0;
    return this.raw(ESC, 0x61, n);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! — width/height multipliers 1..8 (clamped). 1,1 = normal. */
  size(width = 1, height = 1): this {
    const w = Math.min(Math.max(width, 1), 8) - 1;
    const h = Math.min(Math.max(height, 1), 8) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  /** Append text (no newline). */
  text(s: string): this {
    this.chunks.push(Buffer.from(s, 'utf8'));
    return this;
  }

  /** Append text followed by CR LF. */
  line(s = ''): this {
    return this.text(s).raw(0x0d, 0x0a);
  }

  /** Feed n blank lines (ESC d n). */
  feed(n = 1): this {
    return this.raw(ESC, 0x64, n & 0xff);
  }

  /** A full-width separator rule drawn with a repeated character. */
  rule(char = '-'): this {
    return this.line(char.repeat(LINE_WIDTH));
  }

  /**
   * Two-column row: left text and right text on one line, right-justified to
   * LINE_WIDTH. Truncates the left side if the row would overflow.
   */
  row(left: string, right: string): this {
    const space = LINE_WIDTH - right.length;
    let l = left;
    if (l.length > space - 1) l = l.slice(0, Math.max(space - 1, 0));
    const pad = Math.max(LINE_WIDTH - l.length - right.length, 1);
    return this.line(l + ' '.repeat(pad) + right);
  }

  /** Open cash drawer (ESC p m t1 t2) — pin 0, standard pulse. */
  openCashDrawer(): this {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  /** GS V — feed and full cut. */
  cut(feedDots = 0x00): this {
    return this.raw(GS, 0x56, 0x42, feedDots & 0xff);
  }

  /** Append raw bytes. */
  raw(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
