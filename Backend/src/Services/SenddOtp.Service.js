import nodemailer from "nodemailer";
import { prisma } from "../config/db.prismaSQL.js";

export async function sendOtp(email) {
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes validity

  // Upsert OTP: if user repeatedly requests OTP, update existing record with fresh code and reset attempts
  await prisma.oTP.upsert({
    where: { email: normalizedEmail },
    update: {
      otp,
      attempts: 0,
      createdAt: new Date(),
      expiresAt,
    },
    create: {
      email: normalizedEmail,
      otp,
      attempts: 0,
      createdAt: new Date(),
      expiresAt,
    },
  });

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const html = `
    <div style="font-family:sans-serif;">
      <h2>Your OTP is: ${otp}</h2>
      <p>This OTP is valid for 10 minutes.</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: "web analytics  <prakashkotya100@gmail.com>",
    to: email,
    subject: "web analytics  otp",
    html,
  });

  return { success: true, message: `OTP sent successfully on ${email}` };
}


export async function sendSiteDownEmail(paramsOrTo, maybeUrl, maybeResult) {
  let to, userName, url, monitorId, result, checkedAt, hostinginfo;

  if (typeof paramsOrTo === "object" && paramsOrTo !== null) {
    ({
      to,
      userName = "User",
      url,
      monitorId,
      result = {},
      checkedAt = new Date(),
      hostinginfo = null,
    } = paramsOrTo);
  } else {
    to = paramsOrTo;
    url = maybeUrl;
    result = maybeResult || {};
    userName = "User";
    checkedAt = new Date();
    hostinginfo = null;
  }

  if (!to || !url) {
    console.error("[sendSiteDownEmail] Missing required fields (to, url)");
    return { success: false, error: "Recipient email and target URL are required" };
  }

  const normalizedEmail = (Array.isArray(to) ? to.join(",") : to).trim().toLowerCase();

  // If email credentials are not configured in environment, safely skip with warning
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(
      `[sendSiteDownEmail] EMAIL_USER or EMAIL_PASS not set in environment. Skipping email alert to ${normalizedEmail} for ${url}.`
    );
    return {
      success: false,
      skipped: true,
      error: "SMTP credentials not configured in environment",
    };
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const failureReason = result?.reason || (result?.httpStatus ? `HTTP ${result.httpStatus}` : "UNREACHABLE");
  const httpCodeText = result?.httpStatus ? ` (HTTP ${result.httpStatus})` : "";
  const subject = `🚨 Uptime Alert: ${url} is DOWN${httpCodeText} - Web Analytics`;

  const formattedDate = new Date(checkedAt).toUTCString();
  const errorDetails = result?.error || result?.reason || "Connection Timeout / Unreachable";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Website Downtime Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <!-- Header Alert Banner -->
          <tr>
            <td style="background-color: #dc2626; padding: 22px 30px; text-align: left;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: 0.3px;">
                🚨 Incident Alert: Website is DOWN
              </h1>
            </td>
          </tr>
          
          <!-- Body Content -->
          <tr>
            <td style="padding: 28px 30px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; color: #1f2937;">
                Hello <strong>${userName}</strong>,
              </p>
              <p style="margin: 0 0 22px 0; font-size: 15px; line-height: 22px; color: #4b5563;">
                Our uptime monitoring system detected that your website is currently unreachable and is reporting a
                <span style="display: inline-block; background-color: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 13px;">DOWN</span> status.
              </p>

              <!-- Incident Details Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; width: 140px; font-weight: 600;">Website URL:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #111827; font-weight: 600; word-break: break-all;">
                          <a href="${url}" style="color: #2563eb; text-decoration: underline;" target="_blank">${url}</a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Status:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #dc2626; font-weight: 700;">
                          🔴 DOWN
                        </td>
                      </tr>
                      ${
                        result?.httpStatus
                          ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">HTTP Status:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #dc2626; font-weight: 700;">
                          ${result.httpStatus}
                        </td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Reason:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #111827; font-family: monospace;">
                          ${failureReason}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Error Details:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #b91c1c; font-family: monospace; word-break: break-all;">
                          ${errorDetails}
                        </td>
                      </tr>
                      ${
                        result?.responseTime
                          ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Response Time:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #111827;">
                          ${result.responseTime} ms
                        </td>
                      </tr>
                      `
                          : ""
                      }
                      ${
                        result?.dnsAddress
                          ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Resolved IP:</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #111827; font-family: monospace;">
                          ${result.dnsAddress}
                        </td>
                      </tr>
                      `
                          : ""
                      }
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280; font-weight: 600;">Checked At:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #4b5563;">
                          ${formattedDate}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Suggested Next Steps -->
              <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #1f2937; font-weight: 600;">
                Recommended Actions:
              </h3>
              <ul style="margin: 0 0 24px 0; padding-left: 20px; font-size: 14px; line-height: 22px; color: #4b5563;">
                <li>Check your server or hosting provider status page for outages.</li>
                <li>Verify your DNS settings and SSL/TLS certificate validity.</li>
                <li>Inspect your web server error logs for application or gateway crashes.</li>
              </ul>

              <p style="margin: 0; font-size: 13px; line-height: 20px; color: #6b7280;">
                Our system will continue monitoring your website automatically and will record recovery data as soon as service is restored.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 30px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
              Web Analytics Uptime Robot &bull; Automated Monitoring
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const textFallback = `
[ALERT] Your monitored website is DOWN: ${url}
Status: DOWN
HTTP Status: ${result?.httpStatus || "N/A"}
Reason: ${failureReason}
Error: ${errorDetails}
Checked At: ${formattedDate}

Please check your web server and hosting provider.
Web Analytics Monitoring
  `.trim();

  try {
    const fromAddress = `Web Analytics <${process.env.EMAIL_USER || "prakashkotya100@gmail.com"}>`;
    const info = await transporter.sendMail({
      from: fromAddress,
      to: normalizedEmail,
      subject,
      text: textFallback,
      html,
    });

    return {
      success: true,
      messageId: info.messageId,
      to: normalizedEmail,
      timestamp: formattedDate,
    };
  } catch (err) {
    console.error(`[sendSiteDownEmail] Failed to send email to ${normalizedEmail}:`, err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

export default {
  sendOtp,
  sendSiteDownEmail,
};
