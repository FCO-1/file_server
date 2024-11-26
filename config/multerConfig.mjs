import multer from "multer";
import path from "path";
import { getDirectories } from '../utils/directoryManager.mjs';

/**
 * Configuración de Multer para el manejo de archivos
 * @returns {Object} Configuración de multer inicializada
 */
export function configureMulter() {
  // Configuración del almacenamiento
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const { chunksDir } = getDirectories();
      cb(null, chunksDir);
    },
    filename: function (req, file, cb) {
      const uploadId = req.body.uploadId;
      const chunkNumber = req.body.chunkNumber;
      console.log('Storage - Body received:', req.body);
      
      // Validar que tengamos los datos necesarios
      if (!uploadId || chunkNumber === undefined) {
        cb(new Error('Missing required upload information'));
        return;
      }
      
      cb(null, `${uploadId}-${chunkNumber}`);
    }
  });

  // Configuración de filtros de archivo
  const fileFilter = (req, file, cb) => {
    // Para chunks, aceptamos application/octet-stream
    if (file.fieldname === 'file' && req.body.chunkNumber !== undefined) {
      cb(null, true);
      return;
    }

    // Para archivos completos, verificamos el tipo MIME
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
      'application/octet-stream', // Agregado para soportar chunks binarios
      // Agrega más tipos MIME según necesites
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  };

  // Opciones de configuración de Multer
  const multerOptions = {
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB máximo por chunk
      fields: 10,                 // Máximo número de campos no-file
    }
  };

  return multer(multerOptions);
}

/**
 * Verifica si un archivo es una imagen basado en su nombre o tipo MIME
 * @param {Object} file Información del archivo
 * @returns {boolean}
 */
export function isImage(file) {
  // Si tenemos el MIME type, usarlo
  if (file.mimetype) {
    return file.mimetype.startsWith('image/');
  }
  
  // Si no, verificar la extensión
  const ext = path.extname(file.originalname).toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  return imageExtensions.includes(ext);
}

/**
 * Obtiene la extensión segura de un archivo
 * @param {string} originalname Nombre original del archivo
 * @returns {string} Extensión del archivo
 */
export function getSafeFileExtension(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  
  // Mapeo de extensiones permitidas
  const safeExtensions = {
    '.jpg': '.jpg',
    '.jpeg': '.jpg',
    '.png': '.png',
    '.gif': '.gif',
    '.webp': '.webp',
    '.svg': '.svg',
    '.pdf': '.pdf'
  };

  return safeExtensions[ext] || '.bin';
}

/**
 * Validaciones adicionales para archivos
 */
export const fileValidations = {
  /**
   * Valida el tamaño máximo de un archivo completo
   * @param {number} totalSize Tamaño total del archivo en bytes
   * @param {number} maxSize Tamaño máximo permitido en bytes
   * @returns {boolean}
   */
  validateFileSize: (totalSize, maxSize = 100 * 1024 * 1024) => { // 100MB por defecto
    return totalSize <= maxSize;
  },

  /**
   * Valida la cantidad de chunks para un archivo
   * @param {number} totalChunks Número total de chunks
   * @param {number} maxChunks Máximo número de chunks permitidos
   * @returns {boolean}
   */
  validateChunkCount: (totalChunks, maxChunks = 1000) => {
    return totalChunks <= maxChunks;
  },

  /**
   * Valida el nombre del archivo
   * @param {string} filename Nombre del archivo
   * @returns {boolean}
   */
  validateFilename: (filename) => {
    // Evitar caracteres especiales y limitar longitud
    const safeFilenameRegex = /^[a-zA-Z0-9._-]+$/;
    return safeFilenameRegex.test(filename) && filename.length <= 255;
  }
};

/**
 * Errores personalizados para el manejo de archivos
 */
export class FileUploadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FileUploadError';
    this.code = code;
  }

  static get codes() {
    return {
      INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
      FILE_TOO_LARGE: 'FILE_TOO_LARGE',
      TOO_MANY_CHUNKS: 'TOO_MANY_CHUNKS',
      INVALID_FILENAME: 'INVALID_FILENAME'
    };
  }
}