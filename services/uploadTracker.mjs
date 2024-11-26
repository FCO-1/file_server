// Almacenamiento en memoria para el seguimiento de cargas
export const chunksTracker = new Map();
export const processingLock = new Map();

/**
 * Estados posibles de una carga
 */
export const UploadStatus = {
  INITIALIZING: 'initializing',
  IN_PROGRESS: 'in_progress',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Obtiene el estado actual de una carga
 * @param {string} uploadId ID de la carga
 * @returns {Object} Estado actual de la carga
 */
export function getUploadStatus(uploadId) {
  const tracking = chunksTracker.get(uploadId);
  
  if (!tracking) {
    return {
      status: UploadStatus.FAILED,
      error: 'Upload not found'
    };
  }

  const isProcessing = processingLock.get(uploadId);
  const isComplete = tracking.chunks.size === tracking.totalChunks;

  let status;
  if (isProcessing) {
    status = UploadStatus.PROCESSING;
  } else if (isComplete) {
    status = UploadStatus.COMPLETED;
  } else if (tracking.chunks.size > 0) {
    status = UploadStatus.IN_PROGRESS;
  } else {
    status = UploadStatus.INITIALIZING;
  }

  return {
    status,
    chunksReceived: tracking.chunks.size,
    totalChunks: tracking.totalChunks,
    filename: tracking.filename,
    uploadStartTime: tracking.timestamp,
    processingStatus: isProcessing ? 'active' : 'inactive'
  };
}

/**
 * Cancela una carga en progreso y limpia sus recursos
 * @param {string} uploadId ID de la carga a cancelar
 * @returns {Object} Resultado de la cancelación
 */
export function cancelUpload(uploadId) {
  const tracking = chunksTracker.get(uploadId);
  
  if (!tracking) {
    throw new Error('Upload not found');
  }

  if (processingLock.get(uploadId)) {
    throw new Error('Cannot cancel upload while processing');
  }

  try {
    // Limpiar chunks almacenados
    cleanupUploadChunks(uploadId, tracking);
    
    // Eliminar registros de seguimiento
    chunksTracker.delete(uploadId);
    processingLock.delete(uploadId);

    return {
      status: UploadStatus.CANCELLED,
      message: 'Upload cancelled successfully'
    };
  } catch (error) {
    console.error('Error canceling upload:', error);
    throw new Error('Failed to cancel upload: ' + error.message);
  }
}

/**
 * Limpia los archivos temporales de una carga
 * @param {string} uploadId ID de la carga
 * @param {Object} tracking Información de seguimiento de la carga
 */
function cleanupUploadChunks(uploadId, tracking) {
  const fs = require('fs');
  const path = require('path');
  const { chunksDir } = require('../utils/directoryManager.mjs').getDirectories();

  // Eliminar cada chunk
  tracking.chunks.forEach(chunkNumber => {
    const chunkPath = path.join(chunksDir, `${uploadId}-${chunkNumber}`);
    if (fs.existsSync(chunkPath)) {
      fs.unlinkSync(chunkPath);
    }
  });

  // Eliminar archivo temporal si existe
  const tempPath = path.join(processingDir, `temp_${uploadId}`);
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }
}

/**
 * Actualiza el estado de progreso de una carga
 * @param {string} uploadId ID de la carga
 * @param {Object} progress Información de progreso
 */
export function updateUploadProgress(uploadId, progress) {
  const tracking = chunksTracker.get(uploadId);
  if (tracking) {
    Object.assign(tracking, progress);
  }
}

/**
 * Marca una carga como fallida
 * @param {string} uploadId ID de la carga
 * @param {string} error Mensaje de error
 */
export function markUploadAsFailed(uploadId, error) {
  const tracking = chunksTracker.get(uploadId);
  if (tracking) {
    tracking.status = UploadStatus.FAILED;
    tracking.error = error;
  }
}