const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const svgPath = path.join('C:\\Users\\mapay\\Desktop\\PUBG LIVE\\web\\โพสเตอร์อันดับ', 'อันดับคะแนนรวม.svg');

try {
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    console.log(`Successfully read SVG file. Size: ${svgContent.length} bytes`);

    const dom = new JSDOM(svgContent, { contentType: "image/svg+xml" });
    const doc = dom.window.document;

    // Find all image elements with aria-label
    const removableImages = doc.querySelectorAll('image[aria-label]');
    console.log(`Found ${removableImages.length} image elements with aria-label.`);

    // Log some details to verify they are the text elements
    if (removableImages.length > 0) {
        console.log('Sample removed elements:');
        for (let i = 0; i < Math.min(5, removableImages.length); i++) {
            console.log(`- Label: "${removableImages[i].getAttribute('aria-label')}"`);
        }
    }

    // Simulate removal
    removableImages.forEach(img => img.remove());
    console.log('Simulated removal of all text-image elements.');

    // Verify they are gone
    const remainingImages = doc.querySelectorAll('image[aria-label]');
    console.log(`Remaining text-image elements: ${remainingImages.length}`);

    if (removableImages.length > 0 && remainingImages.length === 0) {
        console.log('SUCCESS: Logic effectively cleans the SVG text overlays.');
    } else {
        console.error('FAILURE: Something went wrong with the cleaning logic.');
    }

} catch (err) {
    console.error('Error verifying SVG:', err);
}
