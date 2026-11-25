export default function AuthenticationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#edf4fb_48%,#e8f0fb_100%)] px-4 py-10">
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 -top-40 size-[26rem] rounded-full bg-blue-200/45 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -right-32 size-[32rem] rounded-full bg-cyan-100/70 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.7),transparent_48%)]" />
      <div className="relative z-10 flex w-full justify-center">
        {children}
      </div>
    </main>
  );
}
