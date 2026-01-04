/**
 * Email HTML Template Generator
 *
 * Generates a responsive HTML email template with personalized content.
 * Uses template literals for easy customization.
 */

/**
 * Generate HTML email template
 * @param {object} params - Template parameters
 * @param {string} params.subject - Email subject line
 * @param {string} params.heading - Personalized heading text
 * @param {string} params.body - Personalized body text (supports \n for paragraphs)
 * @param {string} params.buttonText - Call-to-action button text (optional)
 * @param {string} params.buttonUrl - Call-to-action button URL (optional)
 * @param {string} params.logoUrl - Logo image URL (optional)
 * @param {string} params.fromName - Sender name for header
 * @returns {string} Complete HTML email
 */
export function generateEmailTemplate({
  subject,
  heading,
  body,
  buttonText,
  buttonUrl,
  logoUrl,
  fromName
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 20px;
      text-align: center;
    }
    .logo {
      max-width: 150px;
      height: auto;
      margin-bottom: 20px;
    }
    .content {
      padding: 40px 30px;
    }
    h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    h2 {
      color: #333;
      font-size: 24px;
      margin-top: 0;
      margin-bottom: 20px;
    }
    p {
      margin: 16px 0;
      color: #555;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      margin: 24px 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      text-align: center;
    }
    .footer {
      background: #f8f9fa;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e9ecef;
    }
    .footer p {
      margin: 8px 0;
      font-size: 14px;
      color: #6c757d;
    }
    .unsubscribe {
      font-size: 12px;
      color: #adb5bd;
      margin-top: 16px;
    }
    .unsubscribe a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="logo" />` : ''}
      <h1>${fromName}</h1>
    </div>
    <div class="content">
      <h2>${heading}</h2>
      ${body.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
      ${buttonText && buttonUrl ? `<a href="${buttonUrl}" class="button" style="display: inline-block; padding: 14px 32px; margin: 24px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; text-align: center;"><span style="color: #ffffff !important;">${buttonText}</span></a>` : ''}
    </div>
    <div class="footer">
      <p>You're receiving this email because you subscribed to our updates.</p>
      <p class="unsubscribe">
        Don't want to receive these emails?
        <a href="#">Manage your preferences</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
