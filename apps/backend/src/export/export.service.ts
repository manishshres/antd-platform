import { Injectable, Logger } from '@nestjs/common';
import { Parser } from 'json2csv';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  /**
   * Export data as a CSV string
   */
  exportCsv<T extends object>(data: T[], fields?: string[]): string {
    try {
      if (data.length === 0) return '';

      const parser = new Parser({ fields });
      return parser.parse(data);
    } catch (err) {
      this.logger.error(
        'Failed to export CSV',
        err instanceof Error ? err.stack : String(err),
      );
      throw new Error('CSV export failed');
    }
  }

  /**
   * Export data as an Excel buffer
   */
  async exportExcel<T extends object>(
    data: T[],
    sheetName: string = 'Data',
  ): Promise<Buffer> {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(sheetName);

      if (data.length > 0) {
        // Generate columns from the keys of the first object
        const columns = Object.keys(data[0]).map((key) => ({
          header: key.charAt(0).toUpperCase() + key.slice(1),
          key,
          width: 20,
        }));
        sheet.columns = columns;

        // Add rows
        data.forEach((item) => {
          sheet.addRow(item);
        });

        // Make header bold
        sheet.getRow(1).font = { bold: true };
      }

      const buffer = await workbook.xlsx.writeBuffer();
      return buffer as unknown as Buffer;
    } catch (err) {
      this.logger.error(
        'Failed to export Excel',
        err instanceof Error ? err.stack : String(err),
      );
      throw new Error('Excel export failed');
    }
  }
}
