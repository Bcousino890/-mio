# SMTP Implementation Summary - SmartBC

## Implementation Complete

This document summarizes the SMTP email configuration system for SmartBC using Ferozo credentials.

## Database Migration

**File**: `/home/user/smartbc/supabase/migrations/0021_email_config.sql`

Creates three tables:
1. `email_config` - Stores encrypted SMTP credentials
2. `password_reset_tokens` - Tracks password reset tokens with expiration
3. RLS policies for admin-only access

## Frontend Components

### Email Configuration Page
**File**: `/home/user/smartbc/app/(admin)/admin/configuracion/email-config-client.tsx`

Client component with:
- Form to input SMTP credentials
- Password visibility toggle
- SSL/TLS toggle
- "Test Connection" button (sends test email)
- "Save Configuration" button
- Status messages for success/error
- Auto-loads existing configuration on mount

Integrated into: `/home/user/smartbc/app/(admin)/admin/configuracion/page.tsx`

## API Endpoints

### Email Configuration Management
- **POST** `/api/admin/configuracion/save-email` - Save/update SMTP config (encrypted)
- **POST** `/api/admin/configuracion/test-email` - Test SMTP connection and send test email
- **GET** `/api/admin/configuracion/get-email` - Retrieve current config (without password)

### Password Reset Flow
- **POST** `/api/auth/forgot-password` - Request password reset (sends email with token)
- **POST** `/api/auth/reset-password` - Reset password using token

### Files:
- `/home/user/smartbc/app/api/admin/configuracion/save-email/route.ts`
- `/home/user/smartbc/app/api/admin/configuracion/test-email/route.ts`
- `/home/user/smartbc/app/api/admin/configuracion/get-email/route.ts`
- `/home/user/smartbc/app/api/auth/forgot-password/route.ts`
- `/home/user/smartbc/app/api/auth/reset-password/route.ts`

## Email Services

### Core Email Service
**File**: `/home/user/smartbc/lib/email/send-email.ts`

Functions:
- `getEmailConfig()` - Fetch config from database
- `decryptPassword()` - Decrypt stored password using AES-256-GCM
- `sendEmail()` - Send email using SMTP
- `testSmtpConnection()` - Test SMTP connection

Uses AES-256-GCM encryption for password storage with secure IV.

### Password Reset Service
**File**: `/home/user/smartbc/lib/email/password-reset.ts`

Functions:
- `generateResetToken()` - Create secure 64-char hex token
- `createPasswordResetToken()` - Store token in database (24h expiry default)
- `verifyResetToken()` - Validate token and return user_id
- `markTokenAsUsed()` - Consume token after use
- `sendPasswordResetEmail()` - Send formatted reset email
- `sendInvitationEmail()` - Send invitation email

### Email Templates
**File**: `/home/user/smartbc/lib/email/templates.ts`

Reusable template generators:
- `getInvitationTemplate()` - Account setup invitation
- `getPasswordResetTemplate()` - Password reset
- `getVerificationTemplate()` - Email verification
- `getNotificationTemplate()` - Generic notifications
- `getTestEmailTemplate()` - Test connection email

## Frontend Pages

### Forgot Password Page
**File**: `/home/user/smartbc/app/auth/forgot-password/page.tsx`

User enters email, receives reset link. Shows success message with 7-day email handling note.

### Reset Password Page
**File**: `/home/user/smartbc/app/auth/reset-password/page.tsx`

User enters new password twice, submits token for validation. Redirects to login on success.

## Configuration

### Environment Variables Required

Add to `.env.local`:
```
EMAIL_ENCRYPTION_KEY=your-secure-encryption-key-min-32-chars
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### Admin Setup Steps

1. **Enable SMTP Encryption Key**
   - Set `EMAIL_ENCRYPTION_KEY` environment variable

2. **Configure SMTP in Admin Panel**
   - Navigate to `/admin/configuracion`
   - Fill in Ferozo SMTP details:
     - Email: `no-reply@bcousinoprop.com`
     - Contraseña: `Contrasena2022@`
     - Servidor: `c1362346.ferozo.com`
     - Puerto: `465`
     - SSL: Enable toggle
   - Click "Probar Conexión" to verify
   - Click "Guardar Configuración"

3. **Test with "Forgot Password"**
   - Go to `/auth/forgot-password`
   - Enter user email
   - Verify email is received

## Security Features

1. **Password Encryption**: AES-256-GCM with random IV per storage
2. **Token Security**: Cryptographically secure 32-byte random tokens
3. **Token Expiration**: 24 hours for reset, 7 days for invites
4. **One-time Use**: Tokens marked as consumed after use
5. **Email Masking**: Forgot password doesn't reveal email existence
6. **HTTPS Only**: All auth endpoints require HTTPS in production
7. **RLS Policies**: Only admins can manage email config

## Dependencies Added

- `nodemailer@^6.10.1` - SMTP client library
- `@types/nodemailer@^6.4.23` - TypeScript definitions

## File Structure

```
/home/user/smartbc/
├── supabase/migrations/
│   └── 0021_email_config.sql
├── lib/email/
│   ├── send-email.ts
│   ├── password-reset.ts
│   ├── templates.ts
│   └── README.md
├── app/(admin)/admin/configuracion/
│   ├── page.tsx (updated)
│   └── email-config-client.tsx
├── app/api/admin/configuracion/
│   ├── save-email/route.ts
│   ├── test-email/route.ts
│   └── get-email/route.ts
├── app/api/auth/
│   ├── forgot-password/route.ts
│   └── reset-password/route.ts
├── app/auth/
│   ├── forgot-password/page.tsx
│   └── reset-password/page.tsx
└── package.json (updated)
```

## Usage Examples

### Send Password Reset Email
```typescript
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/email/password-reset";

const tokenData = await createPasswordResetToken(userId, 24);
const resetUrl = `${appUrl}/auth/reset-password?token=${tokenData.token}`;
await sendPasswordResetEmail(userEmail, userName, resetUrl);
```

### Send Generic Email
```typescript
import { sendEmail } from "@/lib/email/send-email";

await sendEmail({
  to: "user@example.com",
  subject: "Welcome",
  html: "<h1>Hello</h1>"
});
```

## Next Steps

1. Run migration to create database tables
2. Set EMAIL_ENCRYPTION_KEY environment variable
3. Configure SMTP in `/admin/configuracion`
4. Test with "Forgot Password" flow
5. Implement in user invitation system
6. Update login page with "Forgot Password" link

## Troubleshooting

### SMTP Connection Failed
- Verify credentials are correct
- Check that port 465 is accessible from VPS
- Test with: `telnet c1362346.ferozo.com 465`

### Emails Not Received
- Check spam/junk folder
- Verify sender email matches SMTP user
- Review logs for authentication errors

### Token Errors
- Ensure EMAIL_ENCRYPTION_KEY is set correctly
- Check if token hasn't expired (24h default)
- Verify token format (64 character hex)

## Additional Documentation

See `/home/user/smartbc/lib/email/README.md` for detailed API documentation and examples.
