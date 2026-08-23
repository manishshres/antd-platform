import type { LocalOrder, PosSettings } from '../types';
import {
  buildKitchenTicketLines,
  buildReceiptLines,
  type BusinessInfo,
  type ReceiptLine,
} from './receiptFormatter';
import { groupItemsByStation } from './stationRouting';

export interface PrintResult {
  ok: boolean;
  /** Present when ok is false — safe to surface directly to the cashier. */
  error?: string;
}

export interface StationPrintResult {
  stationName: string;
  result: PrintResult;
}

/**
 * Requiring the native module only when a print is actually attempted keeps a
 * missing/not-yet-rebuilt native binary from taking down screens that merely
 * display a "Print" button (see printerService's usage in Settings/CartPanel).
 */
function loadPrinterModule(): typeof import('@vardrz/react-native-bluetooth-escpos-printer') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@vardrz/react-native-bluetooth-escpos-printer');
}

export async function printLines(lines: ReceiptLine[], settings: PosSettings, target: string): Promise<PrintResult> {
  if (!settings.printerEnabled || !target) {
    return { ok: false, error: 'No printer configured — set one up in Settings → Printer.' };
  }

  let mod: typeof import('@vardrz/react-native-bluetooth-escpos-printer');
  try {
    mod = loadPrinterModule();
  } catch {
    return {
      ok: false,
      error: 'Printer support isn’t built into this app yet — rebuild the POS app after installing the printer dependency.',
    };
  }

  const { BluetoothManager, BluetoothEscposPrinter } = mod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const printer = BluetoothEscposPrinter as any;
  // The font-scale setting bumps every line up by its step (capped at the
  // library's max of 3) on top of whatever size the formatter already marks a
  // line as — headers/totals stay proportionally bigger than body text either way.
  // Below Normal (0) there's no negative ESC/POS width/height multiplier — a
  // printer's smallest size at 1x is still Font A. XSmall/Small instead switch
  // to the printer's condensed Font B (fonttype 1); XSmall further tightens
  // line spacing so a ticket printed at that size actually uses less paper.
  const scale = settings.printerFontScale ?? 0;
  const fontType = scale < 0 ? 1 : 0;
  const lineSpace = scale <= -2 ? 20 : 0;

  try {
    await BluetoothManager.connect(target);
    await printer.printerInit();
    if (lineSpace > 0) await printer.printerLineSpace(lineSpace);

    for (const line of lines) {
      await printer.printerAlign(
        line.align === 'center'
          ? BluetoothEscposPrinter.ALIGN.CENTER
          : line.align === 'right'
            ? BluetoothEscposPrinter.ALIGN.RIGHT
            : BluetoothEscposPrinter.ALIGN.LEFT,
      );
      if (line.bold) await printer.setBlob(1);
      const size = Math.max(0, Math.min((line.size === 'double' ? 1 : 0) + scale, 3));
      await printer.printText(`${line.text}\n`, { widthtimes: size, heigthtimes: size, fonttype: fontType });
      if (line.bold) await printer.setBlob(0);
    }

    // Cheap Bluetooth Classic printers can't keep up with a burst of writes —
    // without feeding several blank lines clear of the cutter and giving the
    // printer a moment to actually finish printing, the auto-cut fires before
    // the last line is done and slices through (or drops) the receipt's tail.
    await printer.printText('\n\n\n\n\n', {});
    if (lineSpace > 0) await printer.printerLineSpace(0);
    await printer.printAndFeed(80);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await printer.cutOnePoint();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to print.' };
  }
}

export function printReceipt(
  order: LocalOrder,
  settings: PosSettings,
  business: BusinessInfo | string,
): Promise<PrintResult> {
  return printLines(
    buildReceiptLines(order, business, settings.printerCharsPerLine),
    settings,
    settings.printerTarget,
  );
}

export function printKitchenTicket(order: LocalOrder, settings: PosSettings): Promise<PrintResult> {
  return printLines(buildKitchenTicketLines(order, settings.printerCharsPerLine), settings, settings.printerTarget);
}

export async function testPrint(settings: PosSettings, target?: string): Promise<PrintResult> {
  return printLines(
    [
      { text: 'Coneeko POS', align: 'center', bold: true, size: 'double' },
      { text: 'Test print', align: 'center' },
      { text: new Date().toLocaleString(), align: 'center' },
      { text: '-'.repeat(settings.printerCharsPerLine) },
      { text: 'If you can read this, the' },
      { text: 'printer is set up correctly.' },
    ],
    settings,
    target ?? settings.printerTarget,
  );
}

/**
 * Splits an order's items by kitchen station (see stationRouting.ts) and
 * prints one ticket per non-empty station, each to that station's own paired
 * Bluetooth printer. Items with no station assignment print on the
 * register's default printer under a plain "Kitchen" ticket, so a register
 * with no stations configured keeps behaving exactly like printKitchenTicket.
 */
export async function printKitchenTicketsByStation(
  order: LocalOrder,
  settings: PosSettings,
  employeeName: string | null,
  businessName: string,
): Promise<StationPrintResult[]> {
  const groups = groupItemsByStation(order.items);
  const results: StationPrintResult[] = [];

  for (const group of groups) {
    const stationName = group.station?.name ?? 'Kitchen';
    const target = group.station?.printerTarget ?? settings.printerTarget;
    if (!target) {
      results.push({
        stationName,
        result: { ok: false, error: `No printer paired for ${stationName}.` },
      });
      continue;
    }
    const lines = buildKitchenTicketLines(order, settings.printerCharsPerLine, {
      items: group.items,
      stationName: group.station ? stationName : undefined,
      businessName,
      employeeName,
    });
    // eslint-disable-next-line no-await-in-loop -- tickets go to different physical printers; each must finish (feed+cut) before the next connect() begins.
    const result = await printLines(lines, settings, target);
    results.push({ stationName, result });
  }

  return results;
}
