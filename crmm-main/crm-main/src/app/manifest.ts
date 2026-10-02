import type {MetadataRoute} from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "مسار | Masar CRM",
    short_name: "Masar",
    description: "متابعة العملاء العقاريين لفريق المبيعات.",
    lang: "ar",
    dir: "rtl",
    start_url: "/ar",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#0b3b3c",
    icons: [
      {src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
      {src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
      {src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable"},
    ],
  };
}