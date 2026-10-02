import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.NODE_ENV === "development" ? {
    allowedDevOrigins: ["localhost:3000", "127.0.0.1:3000", "*.app.github.dev", "*.vercel.app"],
    experimental: {
      serverActions: {
        allowedOrigins: ["localhost:3000", "127.0.0.1:3000", "*.app.github.dev", "*.vercel.app"],
      },
    },
  } : {}),
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
