import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

@Injectable()
export class InvoicePdfService {
  async generateInvoicePdf(
    organizationName: string,
    locationName: string,
    period: string,
    usageData: Record<string, number>,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        doc
          .fillColor('#333333')
          .fontSize(24)
          .text('INVOICE', { align: 'right' })
          .moveDown();

        // Company Details
        doc
          .fontSize(10)
          .text(`Organization: ${organizationName}`)
          .text(`Location: ${locationName}`)
          .text(`Billing Period: ${period}`)
          .text(`Date Generated: ${new Date().toLocaleDateString()}`)
          .moveDown(2);

        // Usage Table Header
        doc
          .fontSize(14)
          .text('Usage Breakdown', { underline: true })
          .moveDown();

        // Usage Items
        doc.fontSize(12);
        if (Object.keys(usageData).length === 0) {
          doc.text('No usage recorded for this period.');
        } else {
          for (const [item, amount] of Object.entries(usageData)) {
            // Format item name: call_minutes -> Call Minutes
            const formattedItem = item
              .split('_')
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
            doc.text(`${formattedItem}: ${amount}`);
          }
        }

        // Footer
        doc
          .moveDown(4)
          .fontSize(10)
          .fillColor('gray')
          .text('This is an auto-generated invoice for your usage.', {
            align: 'center',
          });

        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
