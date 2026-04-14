import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export const exportStaffProfilePDF = async (profileElement: HTMLElement, staffName: string) => {
  try {
    const canvas = await html2canvas(profileElement, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(`staff-profile-${staffName.replace(/\s+/g, '-').toLowerCase()}.pdf`);
  } catch (error) {
    console.error('Error generating staff profile PDF:', error);
    throw new Error('Failed to generate staff profile PDF');
  }
};

export const printStaffProfile = (profileElement: HTMLElement) => {
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <html>
        <head>
          <title>Staff Profile</title>
          <style>
            body { margin: 0; padding: 0; }
            @media print {
              body { margin: 0; }
              @page { size: A4; margin: 0; }
            }
          </style>
        </head>
        <body>
          ${profileElement.outerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }
};
