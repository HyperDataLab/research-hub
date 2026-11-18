import type { Metadata } from "next";
import "./globals.css";
import "./sso.css";

export const metadata: Metadata = {
  title: "Research Hub | HyperData Lab",
  description: "Kho tài liệu nghiên cứu dành cho tài khoản HyperData Lab.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
