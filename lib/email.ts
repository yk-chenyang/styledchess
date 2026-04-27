import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT ?? '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendVerificationCode(email: string, code: string) {
  const from = process.env.SMTP_FROM ?? 'StyledChess <noreply@styledchess.com>';
  await transporter.sendMail({
    from,
    to: email,
    subject: 'Verify your StyledChess account',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e8e8e8; border-radius: 12px;">
        <h1 style="color: #769656; margin-bottom: 8px;">StyledChess</h1>
        <h2 style="margin-bottom: 16px;">Verify your email</h2>
        <p>Enter this code to verify your account:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 24px; background: #252538; border-radius: 8px; margin: 24px 0;">
          ${code}
        </div>
        <p style="color: #a0a0b8; font-size: 14px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}
