import { redirect } from "next/navigation";
import { ClientSidebar } from "@/components/client-sidebar";
import { getCurrentProfile } from "@/lib/db/queries/session";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin" || profile.role === "advisor") redirect("/admin");

  const displayName = profile.full_name?.trim() || profile.email;

  return (
    <>
      {/* Background — same lobby photo + overlays as the login screen.
          Uses a CSS background-image instead of <Image fill> to avoid
          scroll-jank from Next.js lazy-loading and srcset switching. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />

      {/* Warm cream overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(135deg,rgba(248,243,233,0.55)_0%,rgba(239,229,210,0.45)_50%,rgba(230,216,184,0.55)_100%)] backdrop-blur-[2px]"
      />

      {/* Soft warm light glow — top-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-40 -top-40 z-0 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,235,190,0.40),transparent_70%)] blur-2xl"
      />

      {/* Gold ambient — center-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed right-0 top-1/3 z-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(201,169,110,0.22),transparent_70%)] blur-3xl"
      />

      {/* Top fade — softens the photo behind the page header */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[36%] bg-[linear-gradient(to_bottom,rgba(248,243,233,0.92)_0%,rgba(248,243,233,0.55)_60%,transparent_100%)]"
      />

      {/* Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(40,28,10,0.20)_100%)]"
      />

      {/* Foreground */}
      <div className="relative z-10 min-h-screen">
        <ClientSidebar user={{ name: displayName, roleKey: "sidebar.role.client" }} />
        <main className="ml-[260px] min-h-screen">{children}</main>
      </div>
    </>
  );
}
