import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // El PDF de la proforma lee las fuentes Sora y el logo del disco (lib/proforma/server/assets.ts).
  outputFileTracingIncludes: {
    "/api/admin/proforma/pdf": ["./assets/fonts/sora/*.ttf", "./assets/brand/logo-kairos-pdf.png"],
    // El PDF de la factura (CC-F5-10) usa las mismas fuentes.
    "/api/admin/facturas/[id]/pdf": ["./assets/fonts/sora/*.ttf", "./assets/brand/logo-kairos-pdf.png"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
