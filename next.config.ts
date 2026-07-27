import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consente il refresh automatico quando l'ambiente di sviluppo viene
  // aperto da un altro dispositivo tramite questo indirizzo di rete.
  allowedDevOrigins: ["10.8.8.186"],
};

export default nextConfig;
