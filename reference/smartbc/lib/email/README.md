# Email System Documentation

## Overview
This directory contains the email sending system for SmartBC using SMTP credentials stored in the database.

## Configuration

### 1. Set the Encryption Key
Create or update `.env.local` with:
```
EMAIL_ENCRYPTION_KEY=your-secure-random-key-here
```

The key should be at least 32 characters long and securely managed in production.

### 2. Configure SMTP in Admin Panel
Navigate to `/admin/configuracion` and add:
- Email remitente (From Email): `no-reply@bcousinoprop.com`
- Contraseña SMTP: `Contrasena2022@`
- Servidor SMTP: `c1362346.ferozo.com`
- Puerto SMTP: `465`
- SSL: Habilitado (toggle on)

Click "Probar Conexión" to verify the settings work.

## Database

The system uses three tables:

### email_config
Stores the encrypted SMTP credentials. Only one record should exist.
- `smtp_server` - SMTP server hostname
- `smtp_port` - SMTP port (usually 465 for SSL)
- `smtp_user` - SMTP username/email
- `smtp_password_encrypted` - Encrypted password (AES-256-GCM)
- `smtp_password_iv` - Initialization vector for decryption
- `use_ssl` - Whether to use SSL/TLS
- `from_email` - Email address to use as sender
- `from_name` - Display name for sender

### password_reset_tokens
Tracks password reset tokens with expiration.
- `user_id` - Reference to auth.users
- `token` - Secure random token (32 bytes hex)
- `expires_at` - Token expiration time (default 24 hours)
- `used_at` - When the token was used/consumed

## API Endpoints

### POST `/api/admin/configuracion/save-email`
Save or update SMTP configuration.

**Request:**
```json
{
  "smtpServer": "c1362346.ferozo.com",
  "smtpPort": 465,
  "smtpUser": "no-reply@bcousinoprop.com",
  "smtpPassword": "Contrasena2022@",
  "useSsl": true,
  "fromEmail": "no-reply@bcousinoprop.com",
  "fromName": "SmartBC"
}
```

### POST `/api/admin/configuracion/test-email`
Test SMTP connection and send a test email.

**Request:**
```json
{
  "smtpServer": "c1362346.ferozo.com",
  "smtpPort": 465,
  "smtpUser": "no-reply@bcousinoprop.com",
  "smtpPassword": "Contrasena2022@",
  "useSsl": true,
  "fromEmail": "no-reply@bcousinoprop.com",
  "fromName": "SmartBC"
}
```

### GET `/api/admin/configuracion/get-email`
Retrieve current SMTP configuration (password not included).

### POST `/api/auth/forgot-password`
Request a password reset token and send reset email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

### POST `/api/auth/reset-password`
Reset password using a valid token.

**Request:**
```json
{
  "token": "hex-encoded-32-byte-token",
  "password": "new-password"
}
```

## Usage Examples

### Send Password Reset Email
```typescript
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/email/password-reset";

// Create token
const tokenData = await createPasswordResetToken(userId, 24); // 24 hours expiry
if (!tokenData) throw new Error("Failed to create token");

// Send email
const resetUrl = `${appUrl}/auth/reset-password?token=${tokenData.token}`;
await sendPasswordResetEmail(userEmail, userName, resetUrl);
```

### Send Generic Email
```typescript
import { sendEmail } from "@/lib/email/send-email";

const result = await sendEmail({
  to: "recipient@example.com",
  subject: "Welcome to SmartBC",
  html: "<h1>Hello!</h1><p>Welcome to our platform.</p>",
  replyTo: "support@example.com"
});

if (!result.success) {
  console.error("Failed to send email:", result.error);
}
```

### Send Invitation Email
```typescript
import { sendInvitationEmail } from "@/lib/email/password-reset";

const inviteUrl = `${appUrl}/auth/setup?token=${inviteToken}`;
await sendInvitationEmail(userEmail, userName, inviteUrl);
```

## Security Notes

1. **Encryption**: Passwords are encrypted using AES-256-GCM with a secure IV
2. **Token Generation**: Uses cryptographically secure random bytes (32 bytes)
3. **Token Expiration**: Tokens expire after the specified duration (default 24h)
4. **One-time Use**: Tokens are marked as used after consumption
5. **Email Masking**: The forgot-password endpoint doesn't reveal if an email exists
6. **Environment Variables**: Always set `EMAIL_ENCRYPTION_KEY` in production

## Migration

To apply the database schema:
```bash
supabase migration up
```

Or manually run the migration SQL in Supabase console.

## Email Templates

### Password Reset Email
Located in `password-reset.ts` - `sendPasswordResetEmail()` function
- Styled HTML email with clear branding
- 24-hour token expiration notice
- Fallback link for email clients that don't support buttons

### Invitation Email
Located in `password-reset.ts` - `sendInvitationEmail()` function
- Welcome message
- 7-day token expiration
- Instructions for account setup

## Troubleshooting

### Connection Failed
1. Verify SMTP credentials are correct
2. Check that the server is accessible from your VPS
3. Ensure SSL/TLS settings match the server configuration
4. Test with telnet: `telnet c1362346.ferozo.com 465`

### Emails Not Received
1. Check spam/junk folder
2. Verify sender email matches SMTP_USER
3. Review email headers for authentication issues
4. Check server logs for bounce messages

### Token Errors
1. Ensure token hasn't expired (24 hours default)
2. Verify token format is correct (64 character hex string)
3. Check if token was already used
4. Ensure token exists in database

## Environment Variables

Required for production:
```
NEXT_PUBLIC_APP_URL=https://your-domain.com
EMAIL_ENCRYPTION_KEY=your-secure-encryption-key-min-32-chars
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Optional:
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
```
