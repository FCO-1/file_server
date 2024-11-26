import { configureMulter } from '../config/multerConfig.mjs';
import { 
  handleChunkUpload, 
  initializeUpload,
  getUploadStatus,
  cancelUpload  // Actualizado para usar el nombre correcto
} from '../controllers/uploadController.mjs';
import { s3Service } from '../services/s3Service.mjs';

export function setupUploadEndpoints(app) {
  const fileUpload = configureMulter();

  // Inicializar carga
  app.post('/upload/init', (req, res) => {
    const result = initializeUpload();
    res.json(result);
  });

  // Subir chunk
  app.post('/upload/chunk', async (req, res) => {
    console.log('Received chunk upload request');
    
    const handleUpload = fileUpload.single('file');
    
    handleUpload(req, res, async function(err) {
      try {
        const result = await handleChunkUpload(err, req, res);
        res.json(result);
      } catch (error) {
        console.error('Processing error:', error);
        res.status(500).json({ 
          error: 'Error processing chunk',
          details: error.message 
        });
      }
    });
  });

  // Obtener estado de la carga
  app.get('/upload/status/:uploadId', (req, res) => {
    try {
      const status = getUploadStatus(req.params.uploadId);
      res.json(status);
    } catch (error) {
      console.error('Error getting upload status:', error);
      res.status(404).json({
        error: 'Upload not found',
        details: error.message
      });
    }
  });

  // Cancelar carga
  app.post('/upload/cancel', (req, res) => {
    try {
      const result = cancelUpload(req.body.upload_id);  // Usando cancelUpload directamente
      res.json(result);
    } catch (error) {
      console.error('Error canceling upload:', error);
      res.status(500).json({
        error: 'Error canceling upload',
        details: error.message
      });
    }
  });

  app.get('/upload/sync-status/:taskId', (req, res) => {
    try {
      const status = s3Service.getSyncStatus(req.params.taskId);
      res.json(status);
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(404).json({
        error: 'Sync task not found',
        details: error.message
      });
    }
  });
}