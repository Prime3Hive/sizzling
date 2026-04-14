import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export const generateReceiptPDF = async (receiptElement: HTMLElement, saleNumber: string) => {
  try {
    // Create canvas from the receipt element
    const canvas = await html2canvas(receiptElement, {
      backgroundColor: '#ffffff',
      scale: 2, // Higher quality
      useCORS: true,
    });

    // Create PDF
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, 120], // Receipt size (80mm x 120mm)
    });

    const imgWidth = 80;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    
    // Save the PDF
    pdf.save(`receipt-${saleNumber}.pdf`);
  } catch (error) {
    console.error('Error generating receipt PDF:', error);
    throw new Error('Failed to generate receipt PDF');
  }
};

export const printReceipt = (receiptElement: HTMLElement) => {
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt</title>
          <style>
            body { margin: 0; padding: 20px; font-family: monospace; }
            @media print {
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          ${receiptElement.outerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }
};