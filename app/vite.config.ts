import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Веб-интерфейс живёт в app/, но использует общий код из ../scripts/lib и
// адреса из ../deployments — поэтому разрешаем Vite читать корень репозитория.
export default defineConfig({
  root: __dirname,
  plugins: [react(), nodePolyfills({ include: ["buffer", "process", "crypto", "stream", "util"], globals: { Buffer: true, process: true } })],
  // одна копия контекста кошелька и React (react-ui тянет свою вложенную копию wallet-adapter-react)
  resolve: { dedupe: ["@solana/wallet-adapter-react", "@solana/wallet-adapter-base", "react", "react-dom"] },
  server: { port: 5173, host: "0.0.0.0", fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
