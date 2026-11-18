import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST) {
    throw new AppError(503, "EMAIL_UNAVAILABLE", "Email delivery is not configured");
  }

  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  return transporter;
}

export function assertEmailConfigured() {
  getTransporter();
}

async function sendMail(options) {
  try {
    await getTransporter().sendMail({ from: env.SMTP_FROM, ...options });
  } catch (error) {
    console.error("Email delivery failed", error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(503, "EMAIL_DELIVERY_FAILED", "Email could not be delivered");
  }
}

export function sendVerificationCode(email, otp) {
  return sendMail({
    to: email,
    subject: "Verify your email address",
    text: `Your verification code is ${otp}. It expires in ${env.EMAIL_OTP_MINUTES} minutes.`,
    html: `<p>Your verification code is <strong>${otp}</strong>.</p><p>It expires in ${env.EMAIL_OTP_MINUTES} minutes.</p>`,
  });
}

export function sendLoginCode(email, otp) {
  return sendMail({
    to: email,
    subject: "Your sign-in code",
    text: `Your sign-in code is ${otp}. It expires in ${env.EMAIL_OTP_MINUTES} minutes.`,
    html: `<p>Your sign-in code is <strong>${otp}</strong>.</p><p>It expires in ${env.EMAIL_OTP_MINUTES} minutes.</p>`,
  });
}

export function sendPasswordResetCode(email, token) {
  return sendMail({
    to: email,
    subject: "Reset your password",
    text: `Use this password reset token in the password reset form: ${token}.`,
    html: `<p>Use this password reset token in the password reset form:</p><p><code>${token}</code></p>`,
  });
}
