import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getDirectories } from '../utils/directoryManager.mjs';

const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Servicio para manejar la limpieza de archivos temporales y residuales
 */
export class CleanupService {
  constructor() {
    this.cleanupRegistry = new Map();
    this.setupPeriodicCleanup();
  }

  /**
   * Registra archivos para limpieza
   * @param {string} uploadId ID de la subida
   * @param {Object} files Archivos a limpiar
   */
  registerForCleanup(uploadId, files) {
    this.cleanupRegistry.set(uploadId, {
      timestamp: Date.now(),
      files,
      cleaned: false
    });
  }

  /**
   * Limpia archivos asociados a una subida
   * @param {string} uploadId ID de la subida
   * @param {boolean} success Indica si la subida fue exitosa
   */
  async cleanupUpload(uploadId, success = false) {
    const { chunksDir, processingDir, uploadDir } = getDirectories();
    const registry = this.cleanupRegistry.get(uploadId);

    try {
      // Limpiar chunks
      const chunkPattern = `${uploadId}-`;
      const files = await readdir(chunksDir);
      for (const file of files) {
        if (file.startsWith(chunkPattern)) {
          await unlink(path.join(chunksDir, file))
            .catch(err => console.warn(`Warning: Could not delete chunk ${file}:`, err));
        }
      }

      // Limpiar archivo temporal de procesamiento
      const tempFile = path.join(processingDir, `temp_${uploadId}`);
      await unlink(tempFile).catch(() => {}); // Ignorar error si no existe

      // Si la subida falló, limpiar el archivo final en uploads
      if (!success && registry?.files?.final) {
        await unlink(path.join(uploadDir, registry.files.final))
          .catch(err => console.warn(`Warning: Could not delete final file:`, err));
      }

      // Marcar como limpiado
      if (registry) {
        registry.cleaned = true;
      }
    } catch (error) {
      console.error(`Error during cleanup for upload ${uploadId}:`, error);
    } finally {
      // Eliminar del registro después de cierto tiempo
      setTimeout(() => {
        this.cleanupRegistry.delete(uploadId);
      }, 3600000); // 1 hora
    }
  }

  /**
   * Configura limpieza periódica
   * @private
   */
  setupPeriodicCleanup() {
    setInterval(async () => {
      await this.performPeriodicCleanup();
    }, 1800000); // 30 minutos
  }

  /**
   * Realiza limpieza periódica de archivos antiguos
   * @private
   */
  async performPeriodicCleanup() {
    const { chunksDir, processingDir, uploadDir } = getDirectories();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas
    const now = Date.now();

    try {
      // Limpiar chunks antiguos
      await this.cleanOldFiles(chunksDir, maxAge);

      // Limpiar archivos de procesamiento antiguos
      await this.cleanOldFiles(processingDir, maxAge);

      // Limpiar uploads huérfanos (opcional, con más cuidado)
      await this.cleanOrphanedUploads(uploadDir, maxAge);

    } catch (error) {
      console.error('Error during periodic cleanup:', error);
    }
  }

  /**
   * Limpia archivos antiguos de un directorio
   * @private
   */
  async cleanOldFiles(directory, maxAge) {
    const now = Date.now();
    const files = await readdir(directory);

    for (const file of files) {
      try {
        const filePath = path.join(directory, file);
        const stats = await stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await unlink(filePath);
          console.log(`Cleaned old file: ${file}`);
        }
      } catch (error) {
        console.warn(`Warning: Could not process ${file}:`, error);
      }
    }
  }

  /**
   * Limpia uploads huérfanos
   * @private
   */
  async cleanOrphanedUploads(uploadDir, maxAge) {
    const files = await readdir(uploadDir);
    const now = Date.now();

    for (const file of files) {
      try {
        const filePath = path.join(uploadDir, file);
        const stats = await stat(filePath);
        
        // Solo eliminar si es muy antiguo y no está en registro
        if (now - stats.mtime.getTime() > maxAge) {
          const isRegistered = Array.from(this.cleanupRegistry.values())
            .some(reg => reg.files.final === file && !reg.cleaned);

          if (!isRegistered) {
            await unlink(filePath);
            console.log(`Cleaned orphaned upload: ${file}`);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not process upload ${file}:`, error);
      }
    }
  }
}

// Exportar instancia única
export const cleanupService = new CleanupService();