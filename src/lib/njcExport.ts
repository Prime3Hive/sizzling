import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  Document,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  HeadingLevel,
} from "docx";

export interface NJCSupplyItem {
  id: string;
  supply_id: string;
  item_date: string;
  description: string;
  per_head_price: number;
  number_of_persons: number;
  line_total: number;
}

export interface NJCSupplyWithItems {
  id: string;
  supply_date: string;
  invoice_title: string;
  payment_status: string;
  supply_details: string;
  subtotal: number;
  service_charge_percent: number;
  service_charge_amount: number;
  vat_percent: number;
  vat_amount: number;
  total_amount: number;
  number_of_supplies: number;
  items: NJCSupplyItem[];
}

const formatNaira = (amount: number) =>
  `₦${amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function exportToExcel(supplies: NJCSupplyWithItems[]) {
  const wb = XLSX.utils.book_new();

  supplies.forEach((supply, idx) => {
    const rows: (string | number)[][] = [
      ["NJC SUPPLY INVOICE"],
      [`RE: ${supply.invoice_title || "PROVISION OF SNACKS"}`],
      [`Invoice Date: ${new Date(supply.supply_date).toLocaleDateString()}`],
      [`Payment Status: ${supply.payment_status.toUpperCase()}`],
      [],
      ["DATE", "DESCRIPTION", "PER HEAD (₦)", "NO OF PERSONS", "TOTAL (₦)"],
    ];

    supply.items.forEach((item) => {
      rows.push([
        new Date(item.item_date).toLocaleDateString(),
        item.description,
        item.per_head_price,
        item.number_of_persons,
        item.line_total,
      ]);
    });

    rows.push([]);
    rows.push(["", "", "", "Subtotal:", supply.subtotal]);
    rows.push(["", "", "", `Service Charge (${supply.service_charge_percent}%):`, supply.service_charge_amount]);
    rows.push(["", "", "", `VAT (${supply.vat_percent}%):`, supply.vat_amount]);
    rows.push(["", "", "", "GRAND TOTAL:", supply.total_amount]);

    if (supply.supply_details) {
      rows.push([]);
      rows.push(["Notes:", supply.supply_details]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
    const sheetName = `Invoice ${idx + 1}`.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/octet-stream" });
  saveAs(blob, `NJC_Supplies_${new Date().toISOString().split("T")[0]}.xlsx`);
}

export async function exportToWord(supplies: NJCSupplyWithItems[]) {
  const sections = supplies.map((supply) => {
    const headerRows = [
      new Paragraph({
        text: "National Judicial Council",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        text: "Supreme Court Complex, Three Arms Zone, Central District, Abuja Nigeria.",
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "" }),
      new Paragraph({
        text: `RE: ${supply.invoice_title || "PROVISION OF SNACKS"}`,
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        text: "INVOICE",
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ text: "" }),
    ];

    const cellBorders = {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
    };

    const headerRow = new DocxTableRow({
      children: ["DATE", "DESCRIPTION", "PER HEAD", "NO OF PERSONS", "TOTAL (₦)"].map(
        (text) =>
          new DocxTableCell({
            children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
            borders: cellBorders,
          })
      ),
    });

    const itemRows = supply.items.map(
      (item) =>
        new DocxTableRow({
          children: [
            new Date(item.item_date).toLocaleDateString(),
            item.description,
            formatNaira(item.per_head_price),
            item.number_of_persons.toString(),
            formatNaira(item.line_total),
          ].map(
            (text) =>
              new DocxTableCell({
                children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })],
                borders: cellBorders,
              })
          ),
        })
    );

    const table = new DocxTable({
      rows: [headerRow, ...itemRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const summaryRows = [
      new Paragraph({ text: "" }),
      new Paragraph({
        children: [new TextRun({ text: `Subtotal: ${formatNaira(supply.subtotal)}`, bold: true, size: 22 })],
        alignment: AlignmentType.RIGHT,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Service Charge (${supply.service_charge_percent}%): ${formatNaira(supply.service_charge_amount)}`,
            size: 22,
          }),
        ],
        alignment: AlignmentType.RIGHT,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `VAT (${supply.vat_percent}%): ${formatNaira(supply.vat_amount)}`,
            size: 22,
          }),
        ],
        alignment: AlignmentType.RIGHT,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `GRAND TOTAL: ${formatNaira(supply.total_amount)}`, bold: true, size: 24 }),
        ],
        alignment: AlignmentType.RIGHT,
      }),
    ];

    return {
      children: [...headerRows, table, ...summaryRows],
    };
  });

  const doc = new Document({ sections });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `NJC_Supplies_${new Date().toISOString().split("T")[0]}.docx`);
}
