import crypto from "crypto";
import { 
  chunksTracker, 
  processingLock, 
  getUploadStatus,
  cancelUpload,  // Importamos directamente como cancelUpload
  updateUploadProgress,
  markUploadAsFailed 
} from '../services/uploadTracker.mjs';
import { combineAndProcessChunks } from '../services/chunkProcessor.mjs';

export function initializeUpload() {
  const uploadId = crypto.randomBytes(16).toString('hex');
  console.log('Initialized upload with ID:', uploadId);
  
  chunksTracker.set(uploadId, {
    chunks: new Set(),
    totalChunks: 0,
    filename: '',
    timestamp: Date.now(),
    status: 'initializing'
  });
  
  return { uploadId };
}

export async function handleChunkUpload(err, req, res) {
  if (err) {
    console.error('Upload error:', err);
    throw new Error(err.message);
  }

  if (!req.file) {
    throw new Error('No file received');
  }

  const { 
    uploadId, 
    chunkNumber, 
    totalChunks, 
    originalFilename,
    preserveOriginal,
    imageQuality,
    processingType
  } = req.body;

  const tracking = chunksTracker.get(uploadId);
  if (!tracking) {
    throw new Error('Invalid upload ID');
  }

  try {
    const chunkNum = parseInt(chunkNumber);
    tracking.chunks.add(chunkNum);
    tracking.totalChunks = parseInt(totalChunks);
    tracking.filename = originalFilename;

    updateUploadProgress(uploadId, {
      lastChunkReceived: Date.now(),
      chunksReceived: tracking.chunks.size
    });

    const processingOptions = {
      type: preserveOriginal === 'true' ? 'preserve' : processingType || 'auto',
      quality: imageQuality ? parseInt(imageQuality) : null,
      metadata: true
    };

    if (tracking.chunks.size === tracking.totalChunks) {
      if (!processingLock.get(uploadId)) {
        processingLock.set(uploadId, true);
        
        try {
          const result = await combineAndProcessChunks(
            uploadId, 
            tracking.totalChunks, 
            tracking.filename,
            processingOptions
          );
          
          chunksTracker.delete(uploadId);
          processingLock.delete(uploadId);
          
          return {
            message: 'Upload completed successfully',
            ...result
          };
        } catch (error) {
          processingLock.delete(uploadId);
          markUploadAsFailed(uploadId, error.message);
          throw error;
        }
      } else {
        return {
          message: 'Chunk received, processing in progress',
          chunksReceived: tracking.chunks.size,
          totalChunks: tracking.totalChunks
        };
      }
    }

    return {
      message: 'Chunk received successfully',
      chunksReceived: tracking.chunks.size,
      totalChunks: tracking.totalChunks
    };
  } catch (error) {
    markUploadAsFailed(uploadId, error.message);
    throw error;
  }
}

// Exportamos las funciones directamente
export { getUploadStatus, cancelUpload };