import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coneeko — Restaurant POS & AI Call Center",
    short_name: "Coneeko",
    description:
      "Point of sale, AI phone ordering, and kitchen operations for restaurants.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#001529",
    theme_color: "#001529",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
