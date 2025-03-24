const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  // Create a transporter using SMTP settings from your .env file
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, // e.g., 'smtp.gmail.com'
    port: process.env.EMAIL_PORT, // e.g., 587
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER, // your email address
      pass: process.env.EMAIL_PASS, // your email password or app password
    },
    tls: {
        rejectUnauthorized: false,  // 👈 This ignores self-signed certificates
      },
  });

  const mailOptions = {
    from: `Midadium <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
