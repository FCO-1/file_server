import sharp from "sharp";
import fs from "fs";

// Tipos de procesamiento
export const ProcessingTypes = {
  OPTIMIZE: 'optimize',    // Optimizar imagen
  PRESERVE: 'preserve',    // Mantener original
  AUTO: 'auto'            // Decidir basado en tipo/tamaño
};

// Configuraciones por tipo de imagen
const ImageConfigs = {
  jpeg: {
    quality: 85,
    mozjpeg: true,
    chromaSubsampling: '4:4:4'
  },
  png: {
    quality: 90,
    compressionLevel: 6,
    palette: true
  },
  webp: {
    quality: 85,
    effort: 4
  }
};

export class ImageProcessor {
  constructor() {
    this.sharp = sharp;
    this.processingQueue = new Map();
  }

  /**
   * Procesa una imagen según los parámetros especificados
   * @param {string} inputPath - Ruta del archivo de entrada
   * @param {string} outputPath - Ruta del archivo de salida
   * @param {Object} options - Opciones de procesamiento
   * @param {string} options.type - Tipo de procesamiento (optimize/preserve/auto)
   * @param {Object} options.metadata - Metadata original de la imagen
   * @returns {Promise<Object>} Resultado del procesamiento
   */
  async processImage(inputPath, outputPath, options = {}) {
    const {
      type = ProcessingTypes.AUTO,
      metadata = null,
      quality = null
    } = options;

    console.log(`Processing image with type: ${type}`);

    try {
      // Obtener información de la imagen
      const imageInfo = await sharp(inputPath).metadata();
      console.log('Image info:', imageInfo);

      // Si es PRESERVE, solo copiar el archivo
      if (type === ProcessingTypes.PRESERVE) {
        await fs.promises.copyFile(inputPath, outputPath);
        return {
          success: true,
          path: outputPath,
          processingType: 'preserved',
          originalSize: imageInfo.size
        };
      }

      // Determinar el tipo de procesamiento para AUTO
      const shouldOptimize = type === ProcessingTypes.AUTO
        ? this.shouldOptimizeImage(imageInfo)
        : true;

      if (!shouldOptimize) {
        await fs.promises.copyFile(inputPath, outputPath);
        return {
          success: true,
          path: outputPath,
          processingType: 'auto-preserved',
          originalSize: imageInfo.size
        };
      }

      // Configurar el procesamiento
      let pipeline = sharp(inputPath);
      const format = imageInfo.format?.toLowerCase();
      const config = this.getProcessingConfig(format, quality);

      // Aplicar configuración según formato
      switch (format) {
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg(config);
          break;
        case 'png':
          pipeline = pipeline.png(config);
          break;
        case 'webp':
          pipeline = pipeline.webp(config);
          break;
        default:
          // Para otros formatos, mantener original
          await fs.promises.copyFile(inputPath, outputPath);
          return {
            success: true,
            path: outputPath,
            processingType: 'unsupported-format',
            originalSize: imageInfo.size
          };
      }

      // Preservar metadata si existe
      if (metadata) {
        pipeline = pipeline.withMetadata();
      }

      // Procesar y guardar
      await pipeline.toFile(outputPath);

      // Verificar resultado
      const processedInfo = await sharp(outputPath).metadata();
      const originalSize = imageInfo.size;
      const processedSize = processedInfo.size;

      // Si la optimización no fue efectiva, usar original
      if (processedSize > originalSize * 0.9) {
        await fs.promises.copyFile(inputPath, outputPath);
        return {
          success: true,
          path: outputPath,
          processingType: 'optimization-reverted',
          originalSize,
          processedSize
        };
      }

      return {
        success: true,
        path: outputPath,
        processingType: 'optimized',
        originalSize,
        processedSize,
        compressionRatio: processedSize / originalSize
      };

    } catch (error) {
      console.error('Error processing image:', error);
      // En caso de error, preservar original
      await fs.promises.copyFile(inputPath, outputPath);
      return {
        success: false,
        error: error.message,
        path: outputPath,
        processingType: 'error-preserved'
      };
    }
  }

  /**
   * Determina si una imagen debe ser optimizada
   * @param {Object} imageInfo - Metadata de la imagen
   * @returns {boolean}
   */
  shouldOptimizeImage(imageInfo) {
    // No optimizar si:
    // 1. La imagen es muy pequeña
    if (imageInfo.size < 50 * 1024) {
      return false;
    }

    // 2. Formato no soportado
    const supportedFormats = ['jpeg', 'jpg', 'png', 'webp'];
    if (!supportedFormats.includes(imageInfo.format?.toLowerCase())) {
      return false;
    }

    // 3. Imagen ya está bien optimizada
    if (imageInfo.size < imageInfo.width * imageInfo.height * 0.15) {
      return false;
    }

    return true;
  }

  /**
   * Obtiene la configuración de procesamiento según el formato
   * @param {string} format - Formato de la imagen
   * @param {number} quality - Calidad especificada
   * @returns {Object} Configuración de procesamiento
   */
  getProcessingConfig(format, quality = null) {
    const baseConfig = ImageConfigs[format] || ImageConfigs.jpeg;
    
    if (quality !== null) {
      return { ...baseConfig, quality };
    }

    return baseConfig;
  }
}

export const imageProcessor = new ImageProcessor();