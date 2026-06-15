// Crea (o actualiza) un usuario con rol admin/advisor/client.
// Uso:
//   node --env-file=.env.local scripts/create-staff.mjs <email> <password> [admin|advisor|client] [full_name]
//
// Ejemplos:
//   node --env-file=.env.local scripts/create-staff.mjs benjamin@bc.com Cousino2026! admin "Benjamín Cousiño"
//   node --env-file=.env.local scripts/create-staff.mjs maria@bc.com Pass1234! advisor "María Pérez"
//   node --env-file=.env.local scripts/create-staff.mjs cliente@bc.com Cliente2026 client "Cliente Prueba"

import { createClient } from "@supabase/supabase-js";

const [, , email, password, roleArg = "admin", fullName] = process.argv;

if (!email || !password) {
  console.error("❌ Falta email o password.\n   Uso: node --env-file=.env.local scripts/create-staff.mjs <email> <password> [admin|advisor|client] [full_name]");
  process.exit(1);
}

const role = ["admin", "advisor", "client"].includes(roleArg) ? roleArg : "admin";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log(`→ Creando usuario ${email} como ${role}...`);

const { data: created, error: createErr } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: fullName ? { full_name: fullName } : {},
});

let userId;
if (createErr) {
  if (createErr.message.includes("already") || createErr.code === "email_exists") {
    console.log("  Usuario ya existía, busco su ID...");
    const { data: list } = await sb.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === email);
    if (!existing) {
      console.error("❌ No se pudo encontrar el usuario existente:", createErr.message);
      process.exit(1);
    }
    userId = existing.id;
  } else {
    console.error("❌ Error creando usuario:", createErr.message);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log("  Usuario creado en auth.users:", userId);
}

const { error: profileErr } = await sb
  .from("profiles")
  .update({
    role,
    full_name: fullName || email,
  })
  .eq("id", userId);

if (profileErr) {
  console.error("❌ Error actualizando profile:", profileErr.message);
  process.exit(1);
}

console.log(`✅ Listo. ${email} ahora es ${role}.`);
console.log(`   Login: ${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(".supabase.co", "")} → tu portal en /login`);
