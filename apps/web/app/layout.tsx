import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ariane",
  description: "Government digitised its departments. This is the map between them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
