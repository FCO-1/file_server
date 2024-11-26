import fs from "fs";
import path from "path";

let directories = null;

export function initializeDirectories(rootDir) {
  directories = {
    uploadDir: path.join(rootDir, 'uploads'),
    chunksDir: path.join(rootDir, 'chunks'),
    processingDir: path.join(rootDir, 'processing')
  };

  Object.values(directories).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  setupCleanupTasks();
}

export function getDirectories() {
  if (!directories) {
    throw new Error('Directories not initialized');
  }
  return directories;
}

function setupCleanupTasks() {
  // Limpieza periódica
  setInterval(() => {
    const now = Date.now();
    
    // Limpiar archivos temporales
    fs.readdirSync(directories.processingDir).forEach(file => {
      const filePath = path.join(directories.processingDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > 60 * 60 * 1000) { // 1 hora
        fs.unlinkSync(filePath);
      }
    });
  }, 60 * 60 * 1000);
}