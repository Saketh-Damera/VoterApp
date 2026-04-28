import nextConfig from "eslint-config-next";

// Flat-config form. eslint-config-next v16 ships a flat config array out of
// the box, so we avoid FlatCompat (the previous wrapper hit a circular
// reference loading next/core-web-vitals).
const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "tsconfig.tsbuildinfo",
    ],
  },
];

export default config;
