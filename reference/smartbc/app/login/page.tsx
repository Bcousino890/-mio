import Image from "next/image";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen overflow-y-auto md:h-screen md:overflow-hidden">
      {/* Lobby photo background */}
      <Image
        src="/login-bg.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />

      {/* Warm cream overlay to soften the photo and integrate it with the brand palette */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(135deg,rgba(248,243,233,0.55)_0%,rgba(239,229,210,0.45)_50%,rgba(230,216,184,0.55)_100%)] backdrop-blur-[2px]"
      />

      {/* Soft warm light glow — top-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,235,190,0.40),transparent_70%)] blur-2xl"
      />

      {/* Gold ambient — center-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/3 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(201,169,110,0.22),transparent_70%)] blur-3xl"
      />

      {/* Top fade — softens the photo behind the logo so it reads cleanly */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[42%] bg-[linear-gradient(to_bottom,rgba(248,243,233,0.92)_0%,rgba(248,243,233,0.55)_55%,transparent_100%)]"
      />

      {/* Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(40,28,10,0.20)_100%)]"
      />

      <div className="relative flex min-h-screen flex-col items-center px-4 pb-8 pt-8 md:h-screen md:pb-6 md:pt-16">
        <BrandLogo size="xl" priority className="mb-6 md:mb-16" />
        <LoginForm />
      </div>
    </main>
  );
}
