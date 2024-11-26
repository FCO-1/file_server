import express from "express";
import { fileURLToPath } from 'url';
import path from "path";
import { setupUploadEndpoints } from './routes/uploadRoutes.mjs';
import { initializeDirectories } from './utils/directoryManager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7000;

// Inicializar directorios necesarios
initializeDirectories(__dirname);

// Configurar endpoints
setupUploadEndpoints(app);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;