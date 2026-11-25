import Image from "next/image";

export function AppLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/faams-logo.png"
      alt="FAAMS — Finance Administration"
      width={1448}
      height={482}
      priority
      className={className}
    />
  );
}
