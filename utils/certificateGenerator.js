// backend/utils/certificateGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs'); // Not strictly needed if piping to buffer
const path = require('path');

// Ensure fonts are available to pdfkit. Place TTF files in an 'assets/fonts' directory in backend.
// For testing, pdfkit will use built-in Helvetica if these are not found.
const fontPathRegular = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf'); // Example
const fontPathBold = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');   // Example

exports.generateCertificatePDF = async (certificateData) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margin: 50
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                resolve(pdfBuffer);
            });
            doc.on('error', (err) => {
                console.error("Error during PDF generation stream:", err);
                reject(err);
            });

            // --- Certificate Content ---
            // Use fallback fonts if custom ones aren't found
            let currentFontRegular = 'Helvetica';
            let currentFontBold = 'Helvetica-Bold';
            try {
                if (fs.existsSync(fontPathRegular)) doc.registerFont('CustomFontRegular', fontPathRegular);
                if (fs.existsSync(fontPathBold)) doc.registerFont('CustomFontBold', fontPathBold);
                currentFontRegular = fs.existsSync(fontPathRegular) ? 'CustomFontRegular' : 'Helvetica';
                currentFontBold = fs.existsSync(fontPathBold) ? 'CustomFontBold' : 'Helvetica-Bold';
            } catch (fontError) {
                console.warn("Custom certificate fonts not registered, using default Helvetica.", fontError.message);
            }


            // Simple White Background (already default for pdfkit)
            // If you wanted a colored background:
            // doc.rect(0, 0, doc.page.width, doc.page.height).fillColor('#f0f0f0').fill(); // Light grey example

            // Border
            doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
               .lineWidth(2)
               .strokeColor("#4A00E0") // Example purple
               .stroke();

            doc.moveDown(2);
            doc.font(currentFontBold).fontSize(28).fillColor('#333333')
               .text('CERTIFICATE OF COMPLETION', { align: 'center' });

            doc.moveDown(1.5);
            doc.font(currentFontRegular).fontSize(16).fillColor('#555555')
               .text('This is to certify that', { align: 'center' });

            doc.moveDown(2);
            doc.font(currentFontBold).fontSize(32).fillColor('#4A00E0')
               .text(certificateData.studentName, { align: 'center' });

            doc.moveDown(1.5);
            doc.font(currentFontRegular).fontSize(16).fillColor('#555555')
               .text('has successfully completed the course', { align: 'center' });

            doc.moveDown(2);
            doc.font(currentFontBold).fontSize(24).fillColor('#4A00E0')
               .text(`"${certificateData.courseName}"`, { align: 'center', ellipsis: true, width: doc.page.width - 100 });

            doc.moveDown(2);
            const completionDateFormatted = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(certificateData.completionDate));
            doc.font(currentFontRegular).fontSize(14).fillColor('#555555')
               .text(`Date of Completion: ${completionDateFormatted}`, { align: 'center' });

            // Certificate ID and Platform Name at the bottom
            const bottomY = doc.page.height - 70;
            doc.font(currentFontRegular).fontSize(10).fillColor('#777777')
               .text(`Certificate ID: ${certificateData.certificateId}`, 50, bottomY);

            doc.font(currentFontRegular).fontSize(10).fillColor('#777777')
                .text('Midadium Platform', doc.page.width - 50 - 100, bottomY, { align: 'right', width: 100 });


            doc.end();
        } catch (error) {
            console.error("Error generating PDF content:", error);
            reject(error);
        }
    });
};