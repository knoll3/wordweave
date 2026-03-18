import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
export default defineConfig({
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        port: Number(process.env.CLIENT_PORT) || 5173,
        proxy: {
            "/api": {
                target: `http://${process.env.API_HOST || "127.0.0.1"}:${Number(process.env.API_PORT) || 4000}`,
                changeOrigin: true,
            },
        },
    },
});
