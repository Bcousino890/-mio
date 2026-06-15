#!/usr/bin/env node

/**
 * Script para configurar SMTP en la BD
 * Uso: node scripts/configure-smtp.js
 */

const { createCipheriv, randomBytes, scryptSync } = require('crypto');
const { execSync } = require('child_process');

// Datos de Ferozo
const SMTP_CONFIG = {
  smtp_server: 'c1362346.ferozo.com',
  smtp_port: 465,
  smtp_user: 'no-reply@bcousinoprop.com',
  smtp_password: 'Contrasena2022@',
  use_ssl: true,
  from_email: 'no-reply@bcousinoprop.com',
  from_name: 'Benjamin Cousiño Propiedades',
};

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'default-insecure-key-change-this';

function encryptPassword(text) {
  const iv = randomBytes(16).toString('hex');
  const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted: `${encrypted}:${authTag}`,
    iv,
  };
}

function main() {
  console.log('Encriptando contraseña SMTP...');
  const { encrypted, iv } = encryptPassword(SMTP_CONFIG.smtp_password);

  console.log('Insertando configuración en BD...');

  const sqlScript = `
DELETE FROM email_config;

INSERT INTO email_config (
  smtp_server,
  smtp_port,
  smtp_user,
  smtp_password_encrypted,
  smtp_password_iv,
  use_ssl,
  from_email,
  from_name
) VALUES (
  '${SMTP_CONFIG.smtp_server}',
  ${SMTP_CONFIG.smtp_port},
  '${SMTP_CONFIG.smtp_user}',
  '${encrypted}',
  '${iv}',
  ${SMTP_CONFIG.use_ssl},
  '${SMTP_CONFIG.from_email}',
  '${SMTP_CONFIG.from_name}'
);
`;

  try {
    // Usar psql a través del contenedor Docker
    const result = execSync(`echo "${sqlScript.replace(/"/g, '\\"')}" | docker exec -i supabase-db psql -U postgres -d postgres`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    console.log('✅ Configuración SMTP guardada exitosamente');
    console.log('Detalles:');
    console.log(`  Servidor: ${SMTP_CONFIG.smtp_server}`);
    console.log(`  Puerto: ${SMTP_CONFIG.smtp_port}`);
    console.log(`  Usuario: ${SMTP_CONFIG.smtp_user}`);
    console.log(`  De: ${SMTP_CONFIG.from_name} <${SMTP_CONFIG.from_email}>`);
  } catch (error) {
    console.error('❌ Error al guardar configuración:', error.message);
    process.exit(1);
  }
}

main();
