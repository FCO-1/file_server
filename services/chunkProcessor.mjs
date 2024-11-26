import fs from "fs";
import path from "path";
import crypto from "crypto";
import { imageProcessor } from './imageProcessor.mjs';
import { getDirectories } from '../utils/directoryManager.mjs';
//import { S3Service } from './s3Service.mjs';
import { s3Service } from './s3Service.mjs'; 
import { cleanupService } from './cleanupService.mjs'; 
/**
 * Procesa y combina chunks de archivo, y una vez completado lo encola para S3
 * @param {string} uploadId ID único de la subida
 * @param {number} totalChunks Número total de chunks esperados
 * @param {string} originalFilename Nombre original del archivo
 * @param {Object} options Opciones de procesamiento
 * @returns {Promise<Object>} Resultado del procesamiento
 */
export async function combineAndProcessChunks(uploadId, totalChunks, originalFilename, options = {}) {
  const { chunksDir, processingDir, uploadDir } = getDirectories();
  const tempFilePath = path.join(processingDir, `temp_${uploadId}`);
  const writeStream = fs.createWriteStream(tempFilePath);
  
  try {

    cleanupService.registerForCleanup(uploadId, {
      temp: `temp_${uploadId}`,
      chunks: Array.from({length: totalChunks}, (_, i) => `${uploadId}-${i}`)
    });
    // 1. Primero aseguramos que tenemos todos los chunks y los combinamos
    await combineChunks(uploadId, totalChunks, chunksDir, writeStream);
    
    // 2. Generamos el nombre final y procesamos el archivo
    const finalFilename = `${crypto.randomBytes(8).toString('hex')}-${originalFilename}`;
    const finalPath = path.join(uploadDir, finalFilename);
    
    
    cleanupService.registerForCleanup(uploadId, {
      temp: `temp_${uploadId}`,
      chunks: Array.from({length: totalChunks}, (_, i) => `${uploadId}-${i}`),
      final: finalFilename
    });
    // 3. Procesamos la imagen
    const result = await imageProcessor.processImage(tempFilePath, finalPath, options);
    
    // 4. Verificamos que el archivo se procesó correctamente
    if (!result.success) {
      throw new Error(`Failed to process file: ${result.error}`);
    }
    // Limpiar archivos temporales después del éxito
    await cleanupService.cleanupUpload(uploadId, true);

  
    
    return {
      filename: finalFilename,
      syncTaskId,
      s3Key,
      ...result
    };
  } catch (error) {
    console.error('Error in combineAndProcessChunks:', error);
    // Aseguramos limpieza en caso de error
    await cleanupService.cleanupUpload(uploadId, false);
    throw error;
  }
}

/**
 * Combina los chunks en un único archivo
 * @private
 */
async function combineChunks(uploadId, totalChunks, chunksDir, writeStream) {
  return new Promise((resolve, reject) => {
    const promises = [];
    
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunksDir, `${uploadId}-${i}`);
      promises.push(
        fs.promises.access(chunkPath)
          .catch(() => reject(new Error(`Missing chunk file: ${chunkPath}`)))
      );
    }

    Promise.all(promises)
      .then(async () => {
        for (let i = 0; i < totalChunks; i++) {
          const chunkPath = path.join(chunksDir, `${uploadId}-${i}`);
          const chunkData = await fs.promises.readFile(chunkPath);
          writeStream.write(chunkData);
        }
        writeStream.end();
        
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      })
      .catch(reject);
  });
}

/**
 * Limpia archivos temporales después de un procesamiento exitoso
 * @private
 */
async function cleanupTempFiles(tempFilePath, uploadId, totalChunks, chunksDir) {
  try {
    await fs.promises.unlink(tempFilePath);
    
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunksDir, `${uploadId}-${i}`);
      if (await fs.promises.access(chunkPath).then(() => true).catch(() => false)) {
        await fs.promises.unlink(chunkPath);
      }
    }
  } catch (error) {
    console.error('Error cleaning up temp files:', error);
    // No lanzamos el error para no afectar el flujo principal
  }
}

/**
 * Maneja errores durante el procesamiento
 * @private
 */
async function handleProcessingError(tempFilePath, uploadId, totalChunks, chunksDir) {
  try {
    if (await fs.promises.access(tempFilePath).then(() => true).catch(() => false)) {
      await fs.promises.unlink(tempFilePath);
    }

    // Intentamos limpiar chunks si es posible
    await cleanupTempFiles(tempFilePath, uploadId, totalChunks, chunksDir);
  } catch (error) {
    console.error('Error handling processing cleanup:', error);
  }
}