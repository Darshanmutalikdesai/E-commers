import {
  cancelCustomerOrder,
  checkoutOrder,
  getAdminOrder,
  getCustomerOrder,
  listAdminOrders,
  listCustomerOrders,
  requestOrderReturn,
  updateAdminOrderStatus,
  updateAdminPaymentStatus,
} from "../services/order.service.js";
import { createInvoicePdf } from "../services/invoice.service.js";

function sendInvoice(res, order) {
  return createInvoicePdf(order).then((pdf) => {
    const safeOrderNumber = order.orderNumber.replace(/[^A-Za-z0-9_-]/g, "_");
    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${safeOrderNumber}.pdf"`,
    });
    return res.status(200).send(pdf);
  });
}

export async function checkoutHandler(req, res) {
  const order = await checkoutOrder(req.auth.userId, req.validated.body);
  return res.status(201).json({ order });
}

export async function listCustomerOrdersHandler(req, res) {
  const result = await listCustomerOrders(req.auth.userId, req.validated.query);
  return res.status(200).json(result);
}

export async function getCustomerOrderHandler(req, res) {
  const order = await getCustomerOrder(req.auth.userId, req.validated.params.orderId);
  return res.status(200).json({ order });
}

export async function cancelCustomerOrderHandler(req, res) {
  const order = await cancelCustomerOrder(
    req.auth.userId,
    req.validated.params.orderId,
    req.validated.body?.reason,
  );
  return res.status(200).json({ order });
}

export async function requestOrderReturnHandler(req, res) {
  const order = await requestOrderReturn(
    req.auth.userId,
    req.validated.params.orderId,
    req.validated.body.reason,
  );
  return res.status(200).json({ order });
}

export async function customerInvoiceHandler(req, res) {
  const order = await getCustomerOrder(req.auth.userId, req.validated.params.orderId);
  return sendInvoice(res, order);
}

export async function listAdminOrdersHandler(req, res) {
  const result = await listAdminOrders(req.validated.query);
  return res.status(200).json(result);
}

export async function getAdminOrderHandler(req, res) {
  const order = await getAdminOrder(req.validated.params.orderId);
  return res.status(200).json({ order });
}

export async function updateAdminOrderStatusHandler(req, res) {
  const order = await updateAdminOrderStatus(
    req.validated.params.orderId,
    req.validated.body.status,
    req.auth.userId,
    req.validated.body.comment,
  );
  return res.status(200).json({ order });
}

export async function updateAdminPaymentStatusHandler(req, res) {
  const order = await updateAdminPaymentStatus(
    req.validated.params.orderId,
    req.validated.body.paymentStatus,
    req.auth.userId,
    req.validated.body.comment,
  );
  return res.status(200).json({ order });
}

export async function adminInvoiceHandler(req, res) {
  const order = await getAdminOrder(req.validated.params.orderId);
  return sendInvoice(res, order);
}
