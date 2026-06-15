# SMTP Email System - Deployment Guide

## Quick Start Checklist

- [ ] Run database migration
- [ ] Set EMAIL_ENCRYPTION_KEY environment variable
- [ ] Restart application
- [ ] Configure SMTP in /admin/configuracion
- [ ] Test connection
- [ ] Update login page with forgot password link

## Step 1: Database Migration

### Local Development
```bash
# Apply migration to local database
supabase migration up
```

### Production (VPS)

SSH into your VPS and run:
```bash
cd /home/user/smartbc
supabase db push
```

Or manually apply the SQL in Supabase console:
- File: `/home/user/smartbc/supabase/migrations/0021_email_config.sql`

## Step 2: Environment Variables

Update `.env.local` or your deployment environment:

```bash
# Required for email encryption/decryption
EMAIL_ENCRYPTION_KEY=your-secure-random-key-here-min-32-chars

# Already configured but verify
NEXT_PUBLIC_APP_URL=https://bcousinoprop.com  # or your domain
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Generate a secure key:
```bash
openssl rand -base64 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 3: Install Dependencies

```bash
cd /home/user/smartbc
npm install
npm run build
```

## Step 4: Restart Application

With PM2:
```bash
pm2 restart smartbc
# or
npm run build && pm2 restart smartbc
```

## Step 5: Configure SMTP in Admin Panel

1. **Login to Admin Dashboard**
   - URL: `https://yourdomain.com/admin`
   - Use admin credentials

2. **Navigate to Settings**
   - Menu: `/admin/configuracion`

3. **Fill in SMTP Configuration**
   - **Email de remitente (From Email)**: `no-reply@bcousinoprop.com`
   - **Nombre de remitente**: `SmartBC` (or your company name)
   - **Servidor SMTP**: `c1362346.ferozo.com`
   - **Puerto SMTP**: `465`
   - **Usuario SMTP**: `no-reply@bcousinoprop.com`
   - **Contraseña SMTP**: `Contrasena2022@`
   - **SSL/TLS**: Enable toggle (✓)

4. **Test Connection**
   - Click "Probar Conexión" button
   - Should receive a test email at configured address
   - If successful, you'll see: "Conexión exitosa. Correo de prueba enviado."

5. **Save Configuration**
   - Click "Guardar Configuración" button
   - Credentials are encrypted before storing

## Step 6: Update Login Page

Add "Forgot Password" link to `/app/login` or wherever users log in:

```tsx
<a href="/auth/forgot-password">
  ¿Olvidaste tu contraseña?
</a>
```

## Verification

### Test Forgot Password Flow

1. Go to `/auth/forgot-password`
2. Enter an admin/user email address
3. Check email inbox (and spam folder)
4. Should receive email with "Restablecer Contraseña" button
5. Click button to go to `/auth/reset-password?token=...`
6. Enter new password twice
7. Should redirect to login on success

### Check Email Logs

In Supabase console:
```sql
-- Check if config was saved
SELECT * FROM email_config;

-- Check reset tokens
SELECT * FROM password_reset_tokens;
```

### Monitor Application Logs

On VPS:
```bash
pm2 logs smartbc
# or
pm2 monit
```

Look for:
- "Email config saved successfully"
- "SMTP connection successful"
- "Error sending email:" (if there are issues)

## Production Checklist

- [ ] Environment variables set on VPS
- [ ] Database migration applied
- [ ] Application rebuilt and restarted
- [ ] SMTP configured in admin panel
- [ ] Test email connection successful
- [ ] Test password reset flow end-to-end
- [ ] Review email logs for any errors
- [ ] Update login page with forgot password link
- [ ] Monitor PM2 logs for email errors in first 24h

## Troubleshooting

### SMTP Connection Fails

1. **Check Credentials**
   ```bash
   # SSH to test server access
   telnet c1362346.ferozo.com 465
   ```

2. **Verify Port 465 is Accessible**
   - Check VPS firewall rules
   - Ensure outbound SMTP access is allowed

3. **Check Environment Variable**
   ```bash
   # Verify EMAIL_ENCRYPTION_KEY is set
   echo $EMAIL_ENCRYPTION_KEY
   ```

### Emails Not Sent

1. **Check PM2 Logs**
   ```bash
   pm2 logs smartbc | grep -i email
   ```

2. **Verify Email Config Exists**
   - Go to `/admin/configuracion` and re-test

3. **Check Spam Folder**
   - Email might be marked as spam

4. **Review Database**
   ```sql
   -- Check if config exists
   SELECT * FROM email_config;
   ```

### Password Reset Token Issues

1. **Token Expired**
   - Default expiry is 24 hours
   - Token is consumed after use

2. **Check Token in Database**
   ```sql
   SELECT * FROM password_reset_tokens 
   WHERE token = 'your-token';
   ```

3. **Reset Time Zone**
   - Ensure database and app use same timezone
   - Default is UTC

## Email Debugging

### Send Test Email Manually

In `psql` or Supabase console:
```sql
-- Test that email config exists and is accessible
SELECT 
  smtp_server,
  smtp_port,
  smtp_user,
  from_email
FROM email_config
LIMIT 1;
```

### Check Auth Service Availability

```bash
# Test from VPS
curl https://yourdomain.com/api/auth/forgot-password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Security Notes

1. **EMAIL_ENCRYPTION_KEY**
   - Must be kept secret
   - Generate unique key for production
   - Rotate periodically (requires re-encryption)

2. **SMTP Password**
   - Never log the decrypted password
   - Stored encrypted in database

3. **Reset Tokens**
   - Cryptographically secure (32-byte random)
   - Single-use only
   - 24-hour expiration

4. **Email Security**
   - Uses SSL/TLS (port 465)
   - Implements DKIM/SPF (Ferozo's responsibility)

## Support

For issues with:
- **SMTP Server**: Contact Ferozo support
- **Email Encryption**: Check EMAIL_ENCRYPTION_KEY
- **Token Verification**: Check database and logs
- **Integration Issues**: Review /lib/email/README.md

## Next Steps

After successful deployment:

1. **Integrate with User Invitations**
   - When creating new users, send invitation emails
   - Use `sendInvitationEmail()` from `/lib/email/password-reset.ts`

2. **Add Email Notifications**
   - For visit requests
   - For property updates
   - For client communications

3. **Monitor Email Delivery**
   - Set up alerts for email failures
   - Review bounce rates
   - Track engagement metrics

4. **Document for Support Team**
   - Password reset process
   - Troubleshooting steps
   - Common issues and solutions
