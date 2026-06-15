import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/db/middleware";

// SmartLinks públicos: `/compartir/{slug}` (link estable por propiedad)
// y `/c/{token}` (link único por envío comercial, con tracking). `/og/*`
// son las imágenes para preview en redes sociales/WhatsApp. Todos
// accesibles sin login.
const PUBLIC_PATHS = ["/login", "/auth", "/compartir", "/c", "/og", "/p"];
const CLIENT_PATHS = ["/inicio", "/propiedades", "/favoritos", "/perfil", "/mensajes"];
const ADMIN_PATHS = ["/admin"];

// Roles que acceden al /admin (staff). Los agent_* van a /admin, no a /inicio.
const STAFF_ROLES = new Set([
  "owner",
  "admin",
  "advisor",
  "agent_junior",
  "agent_senior",
  "agent_admin",
]);

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (startsWithAny(pathname, PUBLIC_PATHS) || pathname === "/") {
    return response;
  }

  const isClient = startsWithAny(pathname, CLIENT_PATHS);
  const isAdmin = startsWithAny(pathname, ADMIN_PATHS);

  if (!isClient && !isAdmin) return response;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role ?? "client";
  const isStaff = STAFF_ROLES.has(role);

  // Clientes y roles sin acceso admin son redirigidos a /inicio
  if (isAdmin && !isStaff) {
    return NextResponse.redirect(new URL("/inicio", request.url));
  }
  // Staff (incluidos agent_*) es redirigido a /admin si intenta acceder a rutas de cliente
  if (isClient && isStaff) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
