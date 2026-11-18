import PDFDocument from "pdfkit";

function addressLines(address) {
  return [
    address.recipientName,
    address.phone,
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(", "),
    address.country,
  ].filter(Boolean);
}

export function createInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      document.fontSize(22).font("Helvetica-Bold").text("INVOICE");
      document.moveDown(0.5);
      document.fontSize(11).font("Helvetica")
        .text(`Order: ${order.orderNumber}`)
        .text(`Date: ${new Date(order.createdAt).toISOString().slice(0, 10)}`)
        .text(`Status: ${order.status}`)
        .text(`Payment: ${order.paymentMethod} / ${order.paymentStatus}`);

      document.moveDown();
      document.font("Helvetica-Bold").text("Shipping address");
      document.font("Helvetica").text(addressLines(order.shippingAddress).join("\n"));
      document.moveDown(0.75);
      document.font("Helvetica-Bold").text("Billing address");
      document.font("Helvetica").text(addressLines(order.billingAddress).join("\n"));

      document.moveDown();
      document.font("Helvetica-Bold").text("Items");
      document.moveDown(0.3);
      for (const item of order.items) {
        const label = item.variantLabel ? ` (${item.variantLabel})` : "";
        document.font("Helvetica-Bold")
          .text(`${item.productName}${label}  [${item.sku}]`);
        document.font("Helvetica")
          .text(`${item.quantity} x INR ${item.unitPrice} = INR ${item.lineTotal}`);
        document.moveDown(0.4);
      }

      document.moveDown();
      document.font("Helvetica")
        .text(`Subtotal: INR ${order.subtotal}`)
        .text(`Discount: INR ${order.discountTotal}`)
        .text(`GST included: INR ${order.taxTotal}`)
        .text(`Shipping: INR ${order.shippingFee}`);
      document.moveDown(0.3);
      document.font("Helvetica-Bold").fontSize(13).text(`Total: INR ${order.total}`);
      if (order.notes) {
        document.moveDown();
        document.font("Helvetica").fontSize(10).text(`Notes: ${order.notes}`);
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
